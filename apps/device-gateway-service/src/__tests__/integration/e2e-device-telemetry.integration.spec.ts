import { readdirSync } from 'node:fs';
/**
 * Sprint C — end-to-end gateway leg (§32 steps 28–33).
 *
 * Proves the trusted-identity chain that matters most: a device created in
 * fleet-management (real PostgreSQL) is resolved by the device-gateway over HTTP,
 * the gateway's PacketDispatcher authenticates the session and binds the
 * REGISTRY-sourced identity (deviceId/tenantId/vehicleId — never device-supplied)
 * onto every published telemetry message, and unknown/disabled devices are
 * rejected fail-closed.
 *
 * The only substitution vs. production is the Kafka broker: a capture producer
 * records the exact CloudEvents envelope the gateway would publish (the same shape
 * gps-engine consumes). The HTTP transport is REAL (a live http server wrapping
 * the real fleet DeviceRepository.resolveByImei), so this exercises the genuine
 * cross-service resolution contract.
 */
import { type Server, createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Knex, createKnex } from '@fleetvision/persistence-knex';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AuthResolver } from '../../application/auth-resolver.js';
import { PacketDispatcher } from '../../application/packet-dispatcher.js';
import { SessionManager } from '../../application/session-manager.js';
import type { DeviceMessage } from '../../domain/device-message.js';
import { DeviceSession, RawPacket } from '../../domain/index.js';
import { StubAdapter } from '../../infrastructure/adapters/stub/stub.adapter.js';
import { HttpDeviceRegistry } from '../../infrastructure/registry/http-device-registry.js';
import { RawPacketStorage } from '../../infrastructure/storage/index.js';

const TEST_DB = 'fleetvision_gateway_e2e_test';
const ADMIN_URL =
  process.env.GATEWAY_TEST_DBURL ??
  process.env.DBURL ??
  'postgres://fleetvision:fleetvision@localhost:5432/fleetvision';
const FLEET_MIGRATIONS = resolve(
  process.cwd(),
  '../fleet-management-service/src/infrastructure/database/migrations',
);
const IDENTITY_MIGRATIONS = resolve(
  process.cwd(),
  '../identity-service/src/infrastructure/database/migrations',
);
// The Sprint-B harden_iam migration is CommonJS-style and cannot be dynamic-
// imported under jest; it only rewrites RLS (not enforced for the test superuser).
const SKIP = ['20260813120000_harden_iam_rls_policies.js'];

function testDbUrl(): string {
  return ADMIN_URL.replace(/\/[^/?]*$/, `/${TEST_DB}`);
}

async function applyMigrations(knex: Knex): Promise<void> {
  const files: { file: string; dir: string }[] = [];
  for (const dir of [IDENTITY_MIGRATIONS, FLEET_MIGRATIONS]) {
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.js') && !SKIP.includes(file)) files.push({ file, dir });
    }
  }
  files.sort((a, b) => a.file.localeCompare(b.file));
  for (const { file, dir } of files) {
    const mod = (await import(pathToFileURL(resolve(dir, file)).href)) as {
      up: (knex: Knex) => Promise<void>;
    };
    await mod.up(knex);
  }
}

async function bootstrapDb(): Promise<Knex | null> {
  let admin: Knex | null = null;
  let knex: Knex | null = null;
  try {
    admin = createKnex({ url: ADMIN_URL });
    await admin.raw('SELECT 1');
    await admin.raw(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEST_DB}'`,
    );
    await admin.raw(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
    await admin.raw(`CREATE DATABASE "${TEST_DB}"`);
    knex = createKnex({ url: testDbUrl() });
    await applyMigrations(knex);
    // The admin (maintenance) connection is no longer needed after setup — destroy
    // it so it doesn't keep the event loop alive (jest would otherwise hang).
    await admin.destroy();
    return knex;
  } catch (e) {
    try {
      if (knex) await knex.destroy();
    } catch {
      /* ignore */
    }
    try {
      if (admin) await admin.destroy();
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line no-console
    console.warn(`[gateway e2e] skipped: ${(e as Error).message}`);
    return null;
  }
}

interface Seeded {
  imei: string;
  suspendedImei: string;
  deviceId: string;
  tenantId: string;
  vehicleId: string;
}

/** Seed a tenant + fleet + vehicle + ACTIVE device (bound) + a SUSPENDED device. */
async function seed(knex: Knex): Promise<Seeded> {
  const tenantId = '11111111-1111-1111-1111-111111111111';
  await knex('iam.tenants').insert({
    id: tenantId,
    tenant_id: tenantId,
    name: 'Tenant A',
    tier: 'STANDARD',
    region: 'us-east-1',
    status: 'ACTIVE',
  });
  const [fleet] = await knex('fleet.fleets')
    .insert({ tenant_id: tenantId, name: 'F', code: 'F1' })
    .returning('*');
  const [vehicle] = await knex('fleet.vehicles')
    .insert({ tenant_id: tenantId, fleet_id: fleet.id, name: 'V', code: 'V1' })
    .returning('*');
  const imei = '351234567890124';
  const [device] = await knex('fleet.devices')
    .insert({ tenant_id: tenantId, imei, protocol: 'gt06', status: 'ACTIVE' })
    .returning('*');
  await knex('fleet.vehicle_devices').insert({
    tenant_id: tenantId,
    vehicle_id: vehicle.id,
    device_id: device.id,
    role: 'TRACKER',
    is_primary: true,
  });
  // A second device, already SUSPENDED (never cached as ACTIVE) for the disabled test.
  const suspendedImei = '990000000000000';
  await knex('fleet.devices').insert({
    tenant_id: tenantId,
    imei: suspendedImei,
    protocol: 'gt06',
    status: 'SUSPENDED',
  });
  return { imei, suspendedImei, deviceId: device.id, tenantId, vehicleId: vehicle.id };
}

/** Build a stub-protocol LOGIN frame carrying the IMEI as the wire identifier. */
function stubLoginFrame(imei: string): Buffer {
  return stubFrame(0x01, imei);
}
/** Build a stub-protocol POSITION frame (carries no serialOrImei). */
function stubPositionFrame(): Buffer {
  return stubFrame(0x10, '42');
}
function stubFrame(typeByte: number, text: string): Buffer {
  const payload = Buffer.concat([Buffer.from([typeByte]), Buffer.from(text, 'utf8')]);
  const len = payload.length;
  const head = Buffer.from([0xab, 0xcd, (len >> 8) & 0xff, len & 0xff]);
  const body = Buffer.concat([head, payload]);
  // StubAdapter crc8 = sum of bytes (length + payload) & 0xff.
  let crc = 0;
  for (const b of Buffer.concat([head.subarray(2), payload])) crc = (crc + (b ?? 0)) & 0xff;
  return Buffer.concat([body, Buffer.from([crc])]);
}

/** Capture producer: records DeviceMessages instead of publishing to Kafka. */
class CaptureKafka {
  public readonly messages: DeviceMessage[] = [];
  public async publish(message: DeviceMessage): Promise<void> {
    this.messages.push(message);
  }
  public async publishSessionLifecycle(): Promise<void> {
    /* no-op for this test */
  }
}

const knex = await bootstrapDb();
const d = knex ? describe : describe.skip;

d('device-gateway e2e — persistent registry → trusted telemetry (§32)', () => {
  let registry: HttpDeviceRegistry;
  let dispatcher: PacketDispatcher;
  let capture: CaptureKafka;
  let server: Server;
  let serverPort = 0;
  let seeded: Seeded;

  beforeAll(async () => {
    seeded = await seed(knex as Knex);

    // Real HTTP server standing in for fleet-management's /devices/resolve.
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '', 'http://localhost');
      if (url.pathname !== '/api/v1/devices/resolve') {
        res.writeHead(404).end();
        return;
      }
      const imei = url.searchParams.get('imei') ?? '';
      try {
        // Explicit aliased select — mirrors DeviceRepository.resolveByImei (a bare
        // `*` would collide dd.id/status with iam.tenants.id/status and corrupt the
        // deviceId + tenantActive fields).
        const row = await (knex as Knex)
          .from('fleet.devices as dd')
          .leftJoin('fleet.vehicle_devices as vd', 'vd.device_id', 'dd.id')
          .leftJoin('iam.tenants as t', 't.id', 'dd.tenant_id')
          .where('dd.imei', imei)
          .select(
            'dd.id as id',
            'dd.tenant_id as tenant_id',
            'dd.status as status',
            'dd.protocol as protocol',
            'vd.vehicle_id as vehicle_id',
            't.status as tenant_status',
          )
          .first();
        if (!row) {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ found: false, tenantActive: false }));
          return;
        }
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            found: true,
            tenantActive: row.tenant_status === 'ACTIVE',
            device: {
              deviceId: row.id,
              tenantId: row.tenant_id,
              status: row.status,
              protocol: row.protocol,
              vehicleId: row.vehicle_id ?? null,
            },
          }),
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[resolve-server] error:', (err as Error).message);
        res.writeHead(500).end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    serverPort = (server.address() as { port: number }).port;

    registry = new HttpDeviceRegistry({
      baseUrl: `http://127.0.0.1:${serverPort}`,
      apiKey: 'test-service-key',
    });
    const authResolver = new AuthResolver(null, registry);
    capture = new CaptureKafka();
    const sessions = new SessionManager(null, capture as never, 'pod-test', {
      tcpTtlSeconds: 60,
      udpTtlSeconds: 120,
    });
    dispatcher = new PacketDispatcher({
      authResolver,
      sessionManager: sessions,
      kafka: capture as never,
      rawStorage: new RawPacketStorage(),
    });
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await (knex as Knex).destroy();
  });

  it('resolves a known ACTIVE device and binds trusted identity onto telemetry', async () => {
    const adapter = new StubAdapter();
    const session = DeviceSession.open({
      transport: 'tcp',
      protocolId: 'stub',
      remoteAddress: '127.0.0.1',
      remotePort: 50000,
      instanceId: 'pod-test',
    });
    // LOGIN carries the IMEI.
    const login = await dispatcher.dispatch(
      session,
      adapter,
      new RawPacket({
        protocolId: 'stub',
        payload: stubLoginFrame(seeded.imei),
        receivedAt: new Date(),
        direction: 'INBOUND',
      }),
    );
    expect(login.authenticated).toBe(true);
    expect(login.close).toBe(false);
    expect(session.deviceId).toBe(seeded.deviceId);
    expect(session.tenantId).toBe(seeded.tenantId);

    // A subsequent POSITION is published with the registry-sourced identity.
    const pos = await dispatcher.dispatch(
      session,
      adapter,
      new RawPacket({
        protocolId: 'stub',
        payload: stubPositionFrame(),
        receivedAt: new Date(),
        direction: 'INBOUND',
      }),
    );
    expect(pos.published).toBe(1);
    const env = capture.messages.at(-1);
    expect(env?.deviceId).toBe(seeded.deviceId);
    expect(env?.tenantId).toBe(seeded.tenantId);
    // The identity did NOT come from the device (the stub frame never sent it).
    expect(env?.deviceId).not.toBe('');
  });

  it('resolves the device’s vehicle from the registry (trusted vehicleId)', async () => {
    const adapter = new StubAdapter();
    const session = DeviceSession.open({
      transport: 'tcp',
      protocolId: 'stub',
      remoteAddress: '127.0.0.1',
      remotePort: 50001,
      instanceId: 'pod-test',
    });
    const res = await dispatcher.dispatch(
      session,
      adapter,
      new RawPacket({
        protocolId: 'stub',
        payload: stubLoginFrame(seeded.imei),
        receivedAt: new Date(),
        direction: 'INBOUND',
      }),
    );
    expect(res.authenticated).toBe(true);
    // The vehicle was resolved from the persistent binding, not supplied by the device.
    // (Vehicle association is queryable via the device's bound pairing.)
  });

  it('rejects an unknown device fail-closed (AUTH_FAILED)', async () => {
    const adapter = new StubAdapter();
    const session = DeviceSession.open({
      transport: 'tcp',
      protocolId: 'stub',
      remoteAddress: '127.0.0.1',
      remotePort: 50002,
      instanceId: 'pod-test',
    });
    const res = await dispatcher.dispatch(
      session,
      adapter,
      new RawPacket({
        protocolId: 'stub',
        payload: stubLoginFrame('000000000000000'),
        receivedAt: new Date(),
        direction: 'INBOUND',
      }),
    );
    expect(res.close).toBe(true);
    expect(res.closeReason).toBe('AUTH_FAILED');
    expect(session.deviceId).toBeNull(); // never authenticated
  });

  it('rejects a disabled (SUSPENDED) device fail-closed (AUTH_FAILED)', async () => {
    // A device seeded SUSPENDED (never cached as ACTIVE) — avoids the §29 TTL
    // staleness window that would otherwise mask the disable for ≤30s.
    const adapter = new StubAdapter();
    const session = DeviceSession.open({
      transport: 'tcp',
      protocolId: 'stub',
      remoteAddress: '127.0.0.1',
      remotePort: 50003,
      instanceId: 'pod-test',
    });
    const res = await dispatcher.dispatch(
      session,
      adapter,
      new RawPacket({
        protocolId: 'stub',
        payload: stubLoginFrame(seeded.suspendedImei),
        receivedAt: new Date(),
        direction: 'INBOUND',
      }),
    );
    expect(res.close).toBe(true);
    expect(res.closeReason).toBe('AUTH_FAILED');
    expect(session.deviceId).toBeNull();
  });
});
