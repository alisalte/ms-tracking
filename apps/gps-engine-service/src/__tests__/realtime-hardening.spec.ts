import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { JwtService } from '@nestjs/jwt';
import { type Socket as ClientSocket, io } from 'socket.io-client';
import { SignalBus } from '../application/signal-bus.js';
import type { GpsEngineConfig } from '../config/gps-engine.config.js';
import { PositionEvent } from '../domain/position-event.js';
import { RealtimeGateway } from '../infrastructure/websocket/realtime.gateway.js';

/**
 * Sprint D §26–§30 — WebSocket hardening against a REAL Socket.IO server
 * (single-node mode — no Redis adapter; the adapter path needs a live Redis
 * and is exercised by the docker-backed suites):
 *
 *   - JWT handshake authn (fail-closed)
 *   - tenant-scoped room authz (cross-tenant subscribe denied)
 *   - multi-tenant isolation (Tenant B never receives Tenant A positions)
 *   - duplicate subscription idempotency + room cap
 *   - union delivery (fleet + vehicle room → exactly ONE event)
 *   - coalescing back-pressure (rapid positions → one update per window)
 */

const WS_PORT = 3991;
const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const VEHICLE_A = '22222222-2222-2222-2222-222222222222';

const JWT_SECRET = 'test-secret-test-secret-test-secret-32';
const config = {
  GPS_WS_PORT: WS_PORT,
  GPS_WS_ENABLED: true,
  GPS_WS_CORS_ORIGIN: '',
  GPS_WS_COALESCE_INTERVAL_MS: 120,
  GPS_WS_MAX_ROOMS_PER_CLIENT: 3,
} as unknown as GpsEngineConfig;

const signalBus = new SignalBus();
const jwt = new JwtService({ secret: JWT_SECRET });
let gateway: RealtimeGateway | null = null;

beforeAll(async () => {
  gateway = new RealtimeGateway({
    config,
    redis: null, // single-node mode — no adapter
    signalBus,
    jwt,
    issuer: 'fleetvision',
    audience: 'fleetvision-api',
  });
  await gateway.onApplicationBootstrap();
  // Allow the server to bind.
  await new Promise((r) => setTimeout(r, 200));
});

afterAll(async () => {
  await gateway?.onApplicationShutdown();
});

const d = () => describe;

function position(messageId: string, tenantId = TENANT_A): PositionEvent {
  return new PositionEvent({
    messageId,
    vehicleId: VEHICLE_A,
    tenantId,
    latitude: 35.7,
    longitude: 51.4,
    speedKph: 40,
    headingDeg: 90,
    altitudeM: null,
    satellites: 8,
    ignitionOn: true,
    capturedAt: new Date(),
    ingestedAt: new Date(),
    protocolId: 'gt06',
    quality: 'VALID',
  });
}

function coalescePosition(i: number): PositionEvent {
  const p = position(`evt-coalesce-${i}`);
  return new PositionEvent({
    messageId: p.messageId,
    vehicleId: p.vehicleId,
    tenantId: p.tenantId,
    latitude: 35.7 + i / 1000,
    longitude: p.longitude,
    speedKph: p.speedKph,
    headingDeg: p.headingDeg,
    altitudeM: p.altitudeM,
    satellites: p.satellites,
    ignitionOn: p.ignitionOn,
    capturedAt: p.capturedAt,
    ingestedAt: p.ingestedAt,
    protocolId: p.protocolId,
    quality: p.quality,
  });
}

function tokenFor(tenantId: string): string {
  return jwt.sign(
    { sub: `user-${tenantId.slice(0, 4)}`, tenant_id: tenantId },
    {
      issuer: 'fleetvision',
      audience: 'fleetvision-api',
      algorithm: 'HS256',
    },
  );
}

function client(token: string | null): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = io(`http://localhost:${WS_PORT}`, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      reconnection: false,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => reject(err));
  });
}

function subscribe(socket: ClientSocket, room: string): Promise<unknown> {
  return new Promise((resolve) => {
    socket.emit('subscribe', room, (res: unknown) => resolve(res));
  });
}

function nextEvent(socket: ClientSocket, event: string, ms = 1500): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} within ${ms}ms`)), ms);
    socket.once(event, (payload: unknown) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function noEvent(socket: ClientSocket, event: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(true), ms);
    socket.once(event, () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

d()('Sprint D §26/§30 — WebSocket auth + tenant isolation', () => {
  it('rejects a handshake without a JWT (fail-closed)', async () => {
    await expect(client(null)).rejects.toThrow(/Unauthorized/i);
  });

  it('rejects a handshake with an INVALID JWT (fail-closed)', async () => {
    await expect(client('not-a-jwt')).rejects.toThrow(/Unauthorized/i);
  });

  it('accepts a valid JWT and allows subscribing to own-tenant rooms only', async () => {
    const socket = await client(tokenFor(TENANT_A));
    const own = await subscribe(socket, `tenant:${TENANT_A}:fleet`);
    expect(own).toEqual({ ok: true });
    const ownVehicle = await subscribe(socket, `tenant:${TENANT_A}:vehicle:${VEHICLE_A}`);
    expect(ownVehicle).toEqual({ ok: true });
    // Cross-tenant subscribe denied — Tenant A cannot see Tenant B.
    const cross = await subscribe(socket, `tenant:${TENANT_B}:fleet`);
    expect(cross).toEqual({ ok: false, error: 'Forbidden.' });
    const crossVehicle = await subscribe(socket, `tenant:${TENANT_B}:vehicle:${VEHICLE_A}`);
    expect(crossVehicle).toEqual({ ok: false, error: 'Forbidden.' });
    socket.disconnect();
  });

  it('MANDATORY §30: Tenant B client NEVER receives Tenant A positions', async () => {
    const tenantA = await client(tokenFor(TENANT_A));
    const tenantB = await client(tokenFor(TENANT_B));
    await subscribe(tenantA, `tenant:${TENANT_A}:fleet`);
    await subscribe(tenantB, `tenant:${TENANT_B}:fleet`);

    const received = nextEvent(tenantA, 'position.update');
    // Coalescing window flush.
    signalBus.emitPosition(position('evt-iso-1'));

    await expect(received).resolves.toBeDefined();
    const bGotNothing = await noEvent(tenantB, 'position.update', 400);
    expect(bGotNothing).toBe(true);

    tenantA.disconnect();
    tenantB.disconnect();
  });

  it('duplicate subscription to the same room is idempotent (ok, single delivery)', async () => {
    const socket = await client(tokenFor(TENANT_A));
    const room = `tenant:${TENANT_A}:fleet`;
    const first = await subscribe(socket, room);
    const second = await subscribe(socket, room);
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });

    const events: unknown[] = [];
    socket.on('position.update', (p) => events.push(p));
    signalBus.emitPosition(position('evt-dup-1'));
    await new Promise((r) => setTimeout(r, 400));
    expect(events).toHaveLength(1); // one event despite both fleet-room subscription
    socket.disconnect();
  });

  it('a client in BOTH fleet and vehicle rooms receives each update exactly ONCE (union)', async () => {
    const socket = await client(tokenFor(TENANT_A));
    await subscribe(socket, `tenant:${TENANT_A}:fleet`);
    await subscribe(socket, `tenant:${TENANT_A}:vehicle:${VEHICLE_A}`);

    const events: unknown[] = [];
    socket.on('position.update', (p) => events.push(p));
    signalBus.emitPosition(position('evt-union-1'));
    await new Promise((r) => setTimeout(r, 400));
    expect(events).toHaveLength(1); // NOT 2 (the old two-emit form delivered twice)
    socket.disconnect();
  });

  it('room cap: subscriptions beyond GPS_WS_MAX_ROOMS_PER_CLIENT are denied', async () => {
    const socket = await client(tokenFor(TENANT_A));
    expect(await subscribe(socket, `tenant:${TENANT_A}:fleet`)).toEqual({ ok: true });
    expect(await subscribe(socket, `tenant:${TENANT_A}:vehicle:v-1`)).toEqual({ ok: true });
    expect(await subscribe(socket, `tenant:${TENANT_A}:vehicle:v-2`)).toEqual({ ok: true });
    // Cap is 3 — the fourth is denied.
    const denied = await subscribe(socket, `tenant:${TENANT_A}:vehicle:v-3`);
    expect(denied).toEqual({ ok: false, error: 'Subscription limit reached.' });
    socket.disconnect();
  });

  it('back-pressure coalescing: rapid positions → ONE update per window (intermediates dropped)', async () => {
    const socket = await client(tokenFor(TENANT_A));
    await subscribe(socket, `tenant:${TENANT_A}:fleet`);

    const events: number[] = [];
    socket.on('position.update', (p: { latitude?: number }) => events.push(p.latitude ?? -1));

    // 5 positions for the same vehicle within one 120ms window (lat encodes i).
    for (let i = 0; i < 5; i++) {
      signalBus.emitPosition(coalescePosition(i));
    }
    await new Promise((r) => setTimeout(r, 500));
    // Exactly one delivery — the LATEST position (latest-position semantics).
    expect(events).toHaveLength(1);
    expect(events[0]).toBeCloseTo(35.704, 5); // evt-coalesce-4's latitude
    socket.disconnect();
  });

  it('reconnect: the client must re-authenticate and re-subscribe (old context not trusted)', async () => {
    const token = tokenFor(TENANT_A);
    const first = await client(token);
    await subscribe(first, `tenant:${TENANT_A}:fleet`);
    first.disconnect();

    // "Reconnect" — a NEW connection with the same identity: rooms do not carry
    // over; it must re-subscribe (which re-validates the principal).
    const second = await client(token);
    const before = await noEvent(second, 'position.update', 300);
    signalBus.emitPosition(position('evt-recon-0'));
    // Not subscribed yet → nothing delivered (no stale rooms after reconnect).
    expect(await noEvent(second, 'position.update', 400)).toBe(true);
    expect(before).toBe(true);

    // Re-subscribe with the FRESH principal → deliveries resume.
    expect(await subscribe(second, `tenant:${TENANT_A}:fleet`)).toEqual({ ok: true });
    const received = nextEvent(second, 'position.update');
    signalBus.emitPosition(position('evt-recon-1'));
    await expect(received).resolves.toBeDefined();
    second.disconnect();
  });
});
