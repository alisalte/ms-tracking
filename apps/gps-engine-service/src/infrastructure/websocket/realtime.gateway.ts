import type { Redis } from '@fleetvision/cache-redis';
import type { TelemetryMetrics } from '@fleetvision/observability';
/**
 * Realtime WebSocket gateway — Socket.IO broadcaster (07 §11).
 *
 * Subscribes to the signal bus (position.update / device.status / trip / idle /
 * parking / engine-hours) and fans the signals out to authorized Socket.IO
 * rooms:
 *   - `tenant:<tid>:fleet`           — all vehicles in a tenant.
 *   - `tenant:<tid>:vehicle:<vid>`   — a single vehicle.
 *
 * Multi-pod fan-out: the `@socket.io/redis-adapter` propagates emissions to
 * sibling broadcaster pods via Redis pub/sub, so a client connected to any pod
 * receives the update (07 §11.3, ADR-015).
 *
 * Delivery semantics (07 §11.4): at-most-once over WebSocket — no ack/retry.
 *
 * Sprint B security (unchanged, mandatory): every connection verifies a Bearer
 * JWT in the handshake (fail-closed — no token / invalid token → connection
 * rejected). A client may only subscribe to rooms within ITS OWN tenant; a
 * cross-tenant subscription is denied (no join). Vehicle-level enforcement is
 * deferred (no per-vehicle ACL exists yet); tenant-scoping is the hard boundary.
 *
 * Sprint D hardening:
 *   - §28 reconnect: rooms are per-connection, so a reconnecting client MUST
 *     re-authenticate (handshake JWT re-verified — old context is never
 *     trusted) and re-subscribe; `subscribe` validates against the FRESH
 *     principal each time. Duplicate subscriptions are naturally idempotent
 *     (Socket.IO `join`), and bounded by `GPS_WS_MAX_ROOMS_PER_CLIENT`.
 *   - §29 back-pressure: position updates are COALESCED per room — at most one
 *     emission per room per GPS_WS_COALESCE_INTERVAL_MS; intermediate positions
 *     are dropped (latest-position semantics — for live tracking the newest
 *     fix is the valuable one). A slow client therefore cannot accumulate an
 *     unbounded backlog from us: the per-room buffer is 1 entry by design.
 *     Dropped intermediates are counted (`fleetvision_ws_dropped_updates_total`).
 *   - no duplicate delivery: a client in BOTH the fleet and a vehicle room
 *     receives each update once (chained `io.to(a).to(b)` targets the room
 *     UNION — the old two-emit form delivered twice).
 *
 * Graceful disable: when GPS_WS_ENABLED=false, the gateway is a no-op (the signal
 * bus still receives emissions, they just go nowhere) — useful for headless test
 * environments and the non-fatal-boot contract.
 */
import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server as IoServer, type Socket } from 'socket.io';
import type {
  DeviceStatusSignal,
  PositionSignal,
  SignalBus,
} from '../../application/signal-bus.js';
import type { GpsEngineConfig } from '../../config/gps-engine.config.js';

export interface RealtimeGatewayDeps {
  readonly config: GpsEngineConfig;
  /** Redis for the multi-pod adapter — null/undefined = single-node mode. */
  readonly redis?: Redis | null;
  readonly signalBus: SignalBus;
  /** JWT verifier (the @fleetvision/auth JwtService) — verifies access tokens. */
  readonly jwt: JwtService;
  readonly issuer: string;
  readonly audience: string;
  /** Telemetry metrics (optional — tests construct the gateway without). */
  readonly metrics?: TelemetryMetrics | null;
}

interface HandshakePrincipal {
  readonly tenantId: string;
  readonly userId: string;
}

/** A pending (coalesced) room broadcast. */
interface PendingPosition {
  readonly fleetRoom: string;
  readonly vehicleRoom: string;
  readonly signal: PositionSignal;
}

export class RealtimeGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('RealtimeGateway');
  private readonly metrics: TelemetryMetrics | null;
  private io: IoServer | null = null;
  /** Per-vehicle coalescing buffer: key = vehicleRoom (1 entry per vehicle). */
  private readonly pendingPositions = new Map<string, PendingPosition>();
  private coalesceTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: RealtimeGatewayDeps) {
    this.metrics = deps.metrics ?? null;
  }

  public async onApplicationBootstrap(): Promise<void> {
    if (!this.deps.config.GPS_WS_ENABLED) {
      this.logger.log('WebSocket broadcaster disabled (GPS_WS_ENABLED=false).');
      this.attachSignalListeners();
      return;
    }
    try {
      await this.start();
    } catch (err) {
      this.logger.error(
        `Failed to start WebSocket server — continuing without realtime push: ${(err as Error).message}`,
      );
    }
    // Always attach signal listeners so the pipeline never blocks on the bus,
    // even when the WS server failed to start.
    this.attachSignalListeners();
  }

  public async onApplicationShutdown(): Promise<void> {
    if (this.coalesceTimer) {
      clearInterval(this.coalesceTimer);
      this.coalesceTimer = null;
    }
    // Flush any coalesced position before closing (best-effort).
    this.flushPositions();
    // Await the server close so the HTTP listener is genuinely released
    // (io.close() without a callback returns before teardown completes).
    if (this.io) {
      await new Promise<void>((resolve) => {
        this.io?.close(() => resolve());
      });
    }
    this.io = null;
  }

  private async start(): Promise<void> {
    // Sprint B: CORS restricted to a configured origin list (no wildcard). The
    // env var is comma-separated; an empty value means no cross-origin clients.
    const corsOrigin = this.deps.config.GPS_WS_CORS_ORIGIN.split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
    const io = new IoServer(this.deps.config.GPS_WS_PORT, {
      // Sprint B: CORS restricted to a configured origin list (no wildcard).
      cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
      maxHttpBufferSize: 1e6,
      pingTimeout: 30_000,
    });

    // Redis adapter for multi-pod fan-out (ADR-015). Optional: without Redis the
    // server runs single-node (fan-out limited to locally-connected clients) —
    // useful for small deployments and tests.
    if (this.deps.redis) {
      const pubClient = this.deps.redis;
      const subClient = this.deps.redis.duplicate();
      io.adapter(createAdapter(pubClient, subClient));
    }

    // Sprint B: handshake authentication — verify a Bearer JWT before the
    // connection is accepted. Fail-closed: missing/invalid/expired → reject.
    io.use((socket, next) => {
      const principal = this.verifyHandshake(socket);
      if (!principal) {
        next(new Error('Unauthorized.'));
        return;
      }
      socket.data.principal = principal;
      next();
    });

    io.on('connection', (socket) => {
      const principal = socket.data.principal as HandshakePrincipal;
      this.logger.debug(`WS client connected: ${socket.id} (tenant ${principal.tenantId})`);
      this.metrics?.wsClients.inc();

      // Sprint B: room authorization — a client may only join rooms within its
      // own tenant. A cross-tenant subscribe is denied (no join).
      socket.on('subscribe', (room: unknown, ack?: (res: unknown) => void) => {
        if (typeof room !== 'string') {
          ack?.({ ok: false, error: 'Bad request.' });
          return;
        }
        const allowed = this.canSubscribe(principal, room);
        const alreadyJoined = socket.rooms.has(room);
        if (allowed && (alreadyJoined || this.roomsWithinCap(socket))) {
          if (!alreadyJoined) {
            socket.join(room);
            this.metrics?.wsSubscriptions.inc(1);
            this.logger.debug(`WS ${socket.id} joined room ${room}`);
          }
          // Duplicate subscribe to an already-joined room is idempotent.
          ack?.({ ok: true });
        } else if (allowed) {
          this.logger.warn(`WS ${socket.id} denied subscription to ${room}: room cap reached.`);
          ack?.({ ok: false, error: 'Subscription limit reached.' });
        } else {
          this.logger.warn(`WS ${socket.id} denied subscription to ${room}`);
          ack?.({ ok: false, error: 'Forbidden.' });
        }
      });
      socket.on('unsubscribe', (room: unknown) => {
        if (typeof room !== 'string') return;
        if (socket.rooms.has(room)) {
          socket.leave(room);
          this.metrics?.wsSubscriptions.dec(1);
        }
      });
      socket.on('disconnect', () => {
        this.metrics?.wsClients.dec();
        // Rooms die with the socket — return their gauge contribution.
        let joined = 0;
        for (const r of socket.rooms) {
          if (r !== socket.id) joined++;
        }
        if (joined > 0) this.metrics?.wsSubscriptions.dec(joined);
        this.logger.debug(`WS client disconnected: ${socket.id}`);
      });
    });

    this.io = io;
    this.logger.log(`WebSocket server listening on :${this.deps.config.GPS_WS_PORT}`);

    // Sprint D §29 — coalescing flush loop (no-op when interval = 0).
    const interval = this.deps.config.GPS_WS_COALESCE_INTERVAL_MS;
    if (interval > 0) {
      this.coalesceTimer = setInterval(() => this.flushPositions(), interval);
      this.coalesceTimer.unref?.();
    }
  }

  /** Room-cap check: `subscribe` may not exceed GPS_WS_MAX_ROOMS_PER_CLIENT. */
  private roomsWithinCap(socket: Socket): boolean {
    // room = socket.id is the implicit per-socket room — exclude it from the count.
    let joined = 0;
    for (const r of socket.rooms) {
      if (r !== socket.id) joined++;
    }
    return joined < this.deps.config.GPS_WS_MAX_ROOMS_PER_CLIENT;
  }

  /**
   * Extract + verify the Bearer JWT from the handshake. Accepts the token in
   * `auth.token` (socket.io client) or the `Authorization` header. Returns null
   * on any failure (fail-closed).
   */
  private verifyHandshake(socket: Socket): HandshakePrincipal | null {
    const auth = socket.handshake.auth as { token?: string } | undefined;
    let token = typeof auth?.token === 'string' ? auth.token : undefined;
    if (!token) {
      const header = socket.handshake.headers.authorization;
      if (typeof header === 'string' && header.startsWith('Bearer ')) {
        token = header.slice('Bearer '.length).trim();
      }
    }
    if (!token) return null;
    try {
      const claims = this.deps.jwt.verify(token, {
        algorithms: ['HS256'],
        issuer: this.deps.issuer,
        audience: this.deps.audience,
      }) as { sub: string; tenant_id: string };
      if (!claims.sub || !claims.tenant_id) return null;
      return { tenantId: claims.tenant_id, userId: claims.sub };
    } catch {
      return null;
    }
  }

  /**
   * A room is allowed iff it is a tenant-scoped room for the caller's own
   * tenant: `tenant:<tid>:fleet` or `tenant:<tid>:vehicle:<vid>`.
   */
  private canSubscribe(principal: HandshakePrincipal, room: string): boolean {
    const prefix = `tenant:${principal.tenantId}:`;
    return room === `${prefix}fleet` || room.startsWith(`${prefix}vehicle:`);
  }

  /** Wire signal-bus emissions → Socket.IO room broadcasts. */
  private attachSignalListeners(): void {
    this.deps.signalBus.onPosition((signal) => this.onPosition(signal));
    this.deps.signalBus.onDeviceStatus((signal) => this.onDeviceStatus(signal));
    // Sprint 8: trip/idle/parking/engine-hours boundary events.
    this.deps.signalBus.onTrip((event) => this.onTripEvent(event));
    this.deps.signalBus.onIdle((event) => this.onIdleEvent(event));
    this.deps.signalBus.onParking((event) => this.onParkingEvent(event));
    this.deps.signalBus.onEngineHours((signal) => this.onEngineHours(signal));
  }

  /**
   * Sprint D §29 — coalesced position broadcast. The newest position per
   * vehicle replaces any pending one (intermediates dropped + counted); the
   * flush loop emits at most once per room per interval. With coalescing
   * disabled (interval 0) every position is emitted directly.
   */
  private onPosition(signal: PositionSignal): void {
    if (!this.io) return;
    const fleetRoom = `tenant:${signal.tenantId}:fleet`;
    const vehicleRoom = `tenant:${signal.tenantId}:vehicle:${signal.vehicleId}`;
    if (!this.coalesceTimer) {
      this.emitPositionOnce(fleetRoom, vehicleRoom, signal);
      return;
    }
    const existing = this.pendingPositions.get(vehicleRoom);
    if (existing) {
      this.metrics?.wsDroppedUpdates.inc();
    }
    this.pendingPositions.set(vehicleRoom, { fleetRoom, vehicleRoom, signal });
  }

  /** Flush all coalesced positions (one emission per room pair). */
  private flushPositions(): void {
    if (!this.io || this.pendingPositions.size === 0) return;
    const pending = [...this.pendingPositions.values()];
    this.pendingPositions.clear();
    for (const p of pending) {
      this.emitPositionOnce(p.fleetRoom, p.vehicleRoom, p.signal);
    }
  }

  /**
   * Emit to the UNION of the fleet + vehicle rooms (chained .to()) so a client
   * subscribed to both receives the update exactly once (Sprint D §28).
   */
  private emitPositionOnce(fleetRoom: string, vehicleRoom: string, signal: PositionSignal): void {
    this.io?.to(fleetRoom).to(vehicleRoom).emit('position.update', signal);
  }

  private onDeviceStatus(signal: DeviceStatusSignal): void {
    if (!this.io) return;
    const fleetRoom = `tenant:${signal.tenantId}:fleet`;
    this.io.to(fleetRoom).emit('device.status', signal);
  }

  /** Sprint 8: broadcast trip/idle/parking/engine-hours events to fleet rooms. */
  private onTripEvent(event: { tenantId: string; vehicleId: string; type: string }): void {
    if (!this.io) return;
    const fleetRoom = `tenant:${event.tenantId}:fleet`;
    const vehicleRoom = `tenant:${event.tenantId}:vehicle:${event.vehicleId}`;
    this.io.to(fleetRoom).to(vehicleRoom).emit('trip.event', event);
  }

  private onIdleEvent(event: { tenantId: string; vehicleId: string }): void {
    if (!this.io) return;
    this.io.to(`tenant:${event.tenantId}:fleet`).emit('idle.event', event);
  }

  private onParkingEvent(event: { tenantId: string; vehicleId: string }): void {
    if (!this.io) return;
    this.io.to(`tenant:${event.tenantId}:fleet`).emit('parking.event', event);
  }

  private onEngineHours(signal: { tenantId: string; vehicleId: string }): void {
    if (!this.io) return;
    this.io.to(`tenant:${signal.tenantId}:fleet`).emit('engine.hours', signal);
  }
}
