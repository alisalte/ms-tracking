import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
/**
 * Sprint E §30 — the mandatory BROWSER-PERSPECTIVE end-to-end acceptance test.
 *
 * Everything the web dashboard touches, for real:
 *
 *   1. LOGIN against the REAL identity-service (docker, seeded tenant admin).
 *   2. Create Fleet → Vehicle → Device over REAL fleet-management HTTP — the
 *      REAL service process (its own main.js, guards, migrator, Kafka consumer).
 *   3. Assign Device → Vehicle over the real binding endpoint (§11).
 *   4. Mint a real service API key (identity /auth/api-keys) → the gateway's
 *      REAL HttpDeviceRegistry resolves the IMEI → trusted identity.
 *   5. Device simulator LOGIN + POSITION frames → REAL gateway dispatcher →
 *      REAL Kafka → REAL gps-engine consumer → throwaway TimescaleDB.
 *   6. REAL Socket.IO client authenticated with the IDENTITY-ISSUED token
 *      receives position.update + device.status (the dashboard's WS path).
 *   7. Sprint E bootstrap endpoints: GET /positions/latest + /devices/status
 *      (the live map's no-N+1 bootstrap) + GET /summary (stat cards).
 *   8. §30 steps 18–21: DISCONNECT → OFFLINE (WS event + projection) →
 *      reconnect → ONLINE again.
 *   9. §29 tenant isolation: a tenant-B client cannot subscribe tenant-A rooms.
 *
 * Skips gracefully when Kafka / PostgreSQL / identity-service are unreachable.
 * Requires the gateway + fleet-management dists:
 *   pnpm --filter device-gateway-service build && pnpm --filter fleet-management-service build
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { JwtService } from '@nestjs/jwt';
import { Kafka, type Producer } from 'kafkajs';
import { type Socket, io } from 'socket.io-client';
import { DeviceStatusController } from '../../api/device-status.controller.js';
import { PositionsController } from '../../api/positions.controller.js';
import { DeviceStatusPipeline } from '../../application/device-status-pipeline.js';
import { PositionPipeline } from '../../application/position-pipeline.js';
import { SignalBus } from '../../application/signal-bus.js';
import { TripEngine } from '../../application/trip-engine.js';
import type { GpsEngineConfig } from '../../config/gps-engine.config.js';
import { DlqProducer } from '../../infrastructure/kafka/dlq-producer.js';
import { GpsEngineKafkaConsumer } from '../../infrastructure/kafka/kafka-consumer.js';
import { DeviceStatusRepository } from '../../infrastructure/persistence/device-status.repository.js';
import { PositionRepository } from '../../infrastructure/persistence/position.repository.js';
import { TripRepository } from '../../infrastructure/persistence/trip.repository.js';
import { RealtimeGateway } from '../../infrastructure/websocket/realtime.gateway.js';

// --- cross-app legs: compiled dists (same pattern as the Sprint D E2E) -------

const GW = fileURLToPath(new URL('../../../../device-gateway-service/dist', import.meta.url));
const FLEET = fileURLToPath(new URL('../../../../fleet-management-service/dist', import.meta.url));
async function distModule(root: string, rel: string): Promise<Record<string, unknown>> {
  return (await import(pathToFileURL(resolve(root, rel)).href)) as Record<string, unknown>;
}

// --- constants ---------------------------------------------------------------

const TEST_DB = `fleetvision_sprinte_e2e_${Date.now().toString(36)}`;
const KAFKA_BROKERS = (process.env.KAFKA_TEST_BROKERS ?? 'localhost:9092').split(',');
const IDENTITY_URL = process.env.IDENTITY_TEST_URL ?? 'http://localhost:3000';
// The seeded bootstrap admin (identity config defaults, provisioned by the seed).
const SEED_TENANT = process.env.SEED_TENANT_NAME ?? 'FleetVision';
const SEED_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@fleetvision.local';
const SEED_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!StrongPass123';
// JWT config = the values the DOCKER identity signs with (infra/docker/.env).
const JWT_SECRET =
  process.env.JWT_SECRET ??
  'd99d9f6f6e1814ab40a9d6585112d4c068b9fdad38281cab50ee64a2f36464e10ab2d93216c7b5d280157e0f30d2674b';
const JWT_ISSUER = process.env.JWT_ISSUER ?? 'fleetvision';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE ?? 'fleetvision-identity';

const RUN = Date.now().toString(36);
const POSITION_TOPIC = `fleetvision.sprinte.e2e.${RUN}.position.raw`;
const SESSION_TOPIC = `fleetvision.sprinte.e2e.${RUN}.session.lifecycle`;
const DEVICE_TOPIC = `fleetvision.sprinte.e2e.${RUN}.device.raw`;
const ALARM_TOPIC = `fleetvision.sprinte.e2e.${RUN}.alarm.raw`;
const ACK_TOPIC = `fleetvision.sprinte.e2e.${RUN}.command.ack`;
const GROUP_ID = `sprinte-e2e-${RUN}`;
const FLEET_HTTP_PORT = 4321;
const WS_PORT = 3994;
const TENANT_B = '99999999-9999-4999-8999-999999999999';

/** Luhn-valid, run-unique 15-digit IMEI (the registry enforces Luhn — §10). */
function luhnImei(seed: number): string {
  // Numeric-only run token (Date.now().toString(36) contains letters → NaN).
  const runDigits = String(Date.now()).slice(-10);
  const base = Array.from(`860${runDigits}${seed}`.slice(0, 14), (c) => Number(c));
  const sum = base
    .map((d, i) => (i % 2 === 0 ? d : d * 2 > 9 ? d * 2 - 9 : d * 2))
    .reduce((a, b) => a + b, 0);
  return `${base.join('')}${(10 - (sum % 10)) % 10}`;
}

// --- graceful gating: identity + Kafka + PostgreSQL -------------------------

async function tryLogin(): Promise<{ token: string; tenantId: string } | null> {
  try {
    const res = await fetch(`${IDENTITY_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': SEED_TENANT },
      body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data: { access_token: string } };
    const payload = JSON.parse(
      atob(body.data.access_token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/') ?? ''),
    ) as { tenant_id?: string };
    if (!payload.tenant_id) return null;
    return { token: body.data.access_token, tenantId: payload.tenant_id };
  } catch {
    return null;
  }
}

const loginCtx = await tryLogin();
if (!loginCtx) {
  console.warn(`[sprinte e2e] skipped (identity unreachable at ${IDENTITY_URL})`);
}

async function tryKafka() {
  try {
    const kafka = new Kafka({ brokers: KAFKA_BROKERS, clientId: `sprinte-e2e-${RUN}` });
    const admin = kafka.admin();
    await admin.connect();
    await admin.createTopics({
      topics: [POSITION_TOPIC, SESSION_TOPIC, DEVICE_TOPIC].map((topic) => ({
        topic,
        numPartitions: 1,
      })),
      waitForLeaders: true,
    });
    return {
      admin,
      producer: kafka.producer({ idempotent: true }),
      consumer: kafka.consumer({ groupId: `${GROUP_ID}-dlqcheck` }),
    };
  } catch (e) {
    console.warn(`[sprinte e2e] skipped (kafka): ${(e as Error).message}`);
    return null;
  }
}
const kafkaCtx = loginCtx ? await tryKafka() : null;

// --- throwaway DB: identity + fleet + gps migrations -------------------------

const ADMIN_URL =
  process.env.GPS_TEST_DBURL ?? 'postgres://fleetvision:fleetvision@localhost:5432/fleetvision';

/** RLS-policy migrations rework privileges the throwaway owner already has —
 * excluded per the established integration-bootstrap convention. */
const SKIP_MIGRATIONS = new Set([
  '20260813120000_harden_iam_rls_policies.js',
  '20260813120000_harden_tracking_rls_policies.js',
  '20260814110000_harden_fleet_rls_policies.js',
]);

async function bootstrapDb() {
  const { createKnex } = await import('@fleetvision/persistence-knex');
  const admin = await createKnex({ url: ADMIN_URL });
  await admin.raw(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEST_DB}'`,
  );
  await admin.raw(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
  await admin.raw(`CREATE DATABASE "${TEST_DB}"`);
  const knex = await createKnex({ url: ADMIN_URL.replace(/\/[^/?]*$/, `/${TEST_DB}`) });
  await knex.raw('CREATE EXTENSION IF NOT EXISTS timescaledb');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS postgis');
  // Identity (iam.tenants + audit — fleet-management joins/writes them) and gps
  // (tracking schema) migrations are applied by direct import. The FLEET
  // migrations are applied by the spawned service's own knex migrator (which
  // also evals the CJS RLS file the direct import cannot).
  const dirs = [
    resolve(process.cwd(), '../identity-service/src/infrastructure/database/migrations'),
    resolve(process.cwd(), 'src/infrastructure/database/migrations'),
  ];
  const files: { file: string; dir: string }[] = [];
  for (const dir of dirs) {
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.js') && !SKIP_MIGRATIONS.has(file)) files.push({ file, dir });
    }
  }
  files.sort((a, b) => a.file.localeCompare(b.file));
  for (const { dir, file } of files) {
    const mod = (await import(pathToFileURL(resolve(dir, file)).href)) as {
      up: (k: typeof knex) => Promise<void>;
    };
    await mod.up(knex);
  }
  return { knex, admin };
}

const dbCtx = kafkaCtx
  ? await bootstrapDb().catch((e: unknown) => {
      console.warn('[sprinte e2e] bootstrapDb failed:', (e as Error)?.message);
      return null;
    })
  : null;
if (kafkaCtx && !dbCtx) console.warn('[sprinte e2e] skipped (postgres unreachable)');
const knex = dbCtx?.knex ?? null;
const d = knex ? describe : describe.skip;

// --- gateway classes (loaded once; dist must be built) -----------------------

const gwRegistryPkg = await distModule(GW, 'infrastructure/registry/index.js');
const HttpDeviceRegistry = gwRegistryPkg.HttpDeviceRegistry as new (o: {
  baseUrl: string;
  apiKey: string;
  maxRetries?: number;
}) => { resolve: (imei: string) => Promise<unknown> };
const AuthResolver = (await distModule(GW, 'application/auth-resolver.js')).AuthResolver as new (
  redis: unknown,
  registry: unknown,
) => { resolve: (imei: string) => Promise<unknown> };
const PacketDispatcher = (await distModule(GW, 'application/packet-dispatcher.js'))
  .PacketDispatcher as new (
  deps: unknown,
) => {
  dispatch: (s: unknown, a: unknown, r: unknown) => Promise<unknown>;
};
const SessionManager = (await distModule(GW, 'application/session-manager.js'))
  .SessionManager as new (
  a: unknown,
  b: unknown,
  pod: string,
  o: unknown,
) => unknown;
const DeviceGatewayKafkaProducer = (await distModule(GW, 'infrastructure/kafka/kafka-producer.js'))
  .DeviceGatewayKafkaProducer as new (
  o: unknown,
) => {
  publish: (m: unknown) => Promise<void>;
  publishSessionLifecycle: (e: Record<string, unknown>) => Promise<void>;
  onApplicationShutdown: () => Promise<void>;
};
const RawPacketStorage = (await distModule(GW, 'infrastructure/storage/index.js'))
  .RawPacketStorage as new () => unknown;
const gwDomain = await distModule(GW, 'domain/index.js');
const DeviceSessionOpener = gwDomain.DeviceSession as {
  open: (init: unknown) => { id: string; state: string; identify: (now?: Date) => void };
};
const RawPacket = gwDomain.RawPacket as new (p: {
  protocolId: string;
  payload: Buffer;
  receivedAt: Date;
  direction: 'INBOUND' | 'OUTBOUND';
}) => unknown;
const DeviceMessage = (await distModule(GW, 'domain/device-message.js')).DeviceMessage as new (
  props: Record<string, unknown>,
) => unknown;

// --- harness helpers ---------------------------------------------------------

async function waitFor<T>(
  fn: () => Promise<T | null | undefined>,
  { timeoutMs = 20_000, intervalMs = 250, what = 'condition' } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** The Sprint D simulator protocol: [e2 0e len_hi len_lo][type][text][sum]. */
function simFrame(typeByte: number, text: string): unknown {
  const payload = Buffer.concat([Buffer.from([typeByte]), Buffer.from(text, 'utf8')]);
  const head = Buffer.from([0xe2, 0x0e, (payload.length >> 8) & 0xff, payload.length & 0xff]);
  const crc = Buffer.concat([head.subarray(2), payload]);
  let sum = 0;
  for (const b of crc) sum = (sum + b) & 0xff;
  return new RawPacket({
    protocolId: 'e2e',
    payload: Buffer.concat([head, payload, Buffer.from([sum])]),
    receivedAt: new Date(),
    direction: 'INBOUND',
  });
}

/** Minimal simulator adapter (duck-typed; same wire as Sprint D's E2eAdapter). */
function simAdapter() {
  return {
    id: 'e2e',
    meta: { id: 'e2e', name: 'E2E', version: '1', vendor: 'test' },
    detect: () => ({ confidence: 0 }),
    frame: () => null,
    decode(raw: { payload: Buffer; receivedAt: Date; rawSize: number; direction: 'INBOUND' }) {
      const body = raw.payload.subarray(4, raw.payload.length - 1);
      const typeByte = body[0] ?? 0;
      const rest = body.subarray(1).toString('utf8');
      const type = typeByte === 0x01 ? 'LOGIN' : 'POSITION';
      const parts = rest.split(',');
      return [
        new DeviceMessage({
          messageId: globalThis.crypto.randomUUID(),
          deviceId: '',
          serialOrImei: type === 'LOGIN' ? rest : '',
          tenantId: '',
          protocolId: 'e2e',
          type,
          timestamp: raw.receivedAt,
          ingestedAt: raw.receivedAt,
          position:
            type === 'POSITION'
              ? {
                  latitude: Number(parts[0] ?? '0') || 0,
                  longitude: Number(parts[1] ?? '0') || 0,
                  speedKph: Number(parts[2] ?? '0') || 0,
                  headingDeg: 0,
                  altitudeM: null,
                  satellites: 8,
                  timestamp: raw.receivedAt,
                  ignitionOn: true,
                }
              : undefined,
          rawSize: raw.rawSize,
          checksum: createHash('sha256').update(raw.payload).digest('hex'),
          direction: raw.direction,
        }),
      ];
    },
    encode: () => Buffer.alloc(0),
  };
}

function wsConnect(authToken: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(`http://localhost:${WS_PORT}`, {
      auth: { token: authToken },
      transports: ['websocket'],
      reconnection: false,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

// ── the suite ────────────────────────────────────────────────────────────────

d('Sprint E E2E — login → fleet CRUD → binding → telemetry → WS (§30)', () => {
  let token = '';
  let tenantId = '';
  let fleetId = '';
  let vehicleId = '';
  let deviceId = '';
  let imei = '';
  let fleetProc: ChildProcess | null = null;
  let dispatcher: InstanceType<typeof PacketDispatcher>;
  let session: ReturnType<typeof DeviceSessionOpener.open>;
  let gatewayProducer: InstanceType<typeof DeviceGatewayKafkaProducer>;
  let consumer: {
    onApplicationBootstrap: () => Promise<void>;
    onApplicationShutdown: () => Promise<void>;
    isRunning: boolean;
  };
  let wsGateway: RealtimeGateway | null = null;
  let statusRepo: DeviceStatusRepository;

  /** fleet-management HTTP bound to the identity-issued token. */
  function fleetHttp(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`http://127.0.0.1:${FLEET_HTTP_PORT}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
  }

  beforeAll(async () => {
    token = (loginCtx as { token: string }).token;
    tenantId = (loginCtx as { tenantId: string }).tenantId;

    // ── fleet-management: the REAL service process (own main.js, guards,
    //    migrator, Kafka consumer) — exactly what a deployment runs. ─────────
    fleetProc = spawn(process.execPath, [resolve(FLEET, 'main.js')], {
      env: {
        ...process.env,
        PORT: String(FLEET_HTTP_PORT),
        HOST: '127.0.0.1',
        DBURL: ADMIN_URL.replace(/\/[^/?]*$/, `/${TEST_DB}`),
        REDISURL: 'redis://localhost:6379/9',
        FLEET_KAFKA_BROKERS: KAFKA_BROKERS.join(','),
        FLEET_KAFKA_CLIENT_ID: `sprinte-fleet-${RUN}`,
        FLEET_KAFKA_GROUP_ID: `${GROUP_ID}-fleet`,
        FLEET_KAFKA_SESSION_TOPIC: SESSION_TOPIC,
        JWT_SECRET,
        JWT_ISSUER,
        JWT_AUDIENCE,
        LOG_LEVEL: 'warn',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    fleetProc.stderr?.on('data', () => {}); // keep the pipe drained
    await waitFor(
      async () => {
        try {
          const res = await fetch(`http://127.0.0.1:${FLEET_HTTP_PORT}/health/live`, {
            signal: AbortSignal.timeout(1_000),
          });
          return res.ok ? true : null;
        } catch {
          return null;
        }
      },
      { timeoutMs: 30_000, what: 'fleet-management service to boot' },
    );

    // ── gateway leg: HttpDeviceRegistry → the fleet HTTP above ──────────────
    // Mint the gateway's service API key via the REAL identity API (§31-style
    // service identity — the dashboard never holds this key), then replicate
    // the key row into the throwaway DB: fleet-management verifies API keys
    // against its OWN iam.api_keys (shared-store deployment shape), and this
    // run's fleet instance points at the test database.
    const keyRes = await fetch(`${IDENTITY_URL}/api/v1/auth/api-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': tenantId,
      },
      body: JSON.stringify({ name: `sprinte-e2e-${RUN}`, scopes: ['device.registry.resolve'] }),
    });
    const keyBody = (await keyRes.json()) as { data: { key: string; key_prefix: string } };
    expect(keyRes.status).toBe(201);
    {
      // Reuse the bootstrap's admin connection (also avoids an extra pool).
      const docker = (
        dbCtx as {
          admin: {
            raw: (sql: string, b?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
          };
        }
      ).admin;
      const rows = (
        await docker.raw('SELECT * FROM iam.api_keys WHERE key_prefix = ?', [
          keyBody.data.key_prefix,
        ])
      ).rows;
      // The registry's resolve joins iam.tenants for the active-tenant check —
      // fetch the (real, seeded) tenant row too.
      const tenantRows = (
        await docker.raw('SELECT * FROM iam.tenants WHERE id = ?::uuid', [tenantId])
      ).rows;
      expect(rows.length).toBe(1);
      expect(tenantRows.length).toBe(1);
      // pg returns json columns as parsed objects — stringify them back for insert.
      const row = { ...rows[0] };
      for (const col of ['scopes', 'ip_allowlist']) {
        if (row[col] !== null && typeof row[col] === 'object') row[col] = JSON.stringify(row[col]);
      }
      const testKnex = knex as never as {
        withSchema: (s: string) => {
          from: (t: string) => { insert: (r: unknown) => Promise<unknown[]> };
        };
      };
      await testKnex.withSchema('iam').from('api_keys').insert(row);
      await testKnex.withSchema('iam').from('tenants').insert(tenantRows[0]);
    }

    const registry = new HttpDeviceRegistry({
      baseUrl: `http://127.0.0.1:${FLEET_HTTP_PORT}`,
      apiKey: keyBody.data.key,
      maxRetries: 1,
    });
    const authResolver = new AuthResolver(null, registry);
    gatewayProducer = new DeviceGatewayKafkaProducer({
      brokers: KAFKA_BROKERS,
      clientId: `sprinte-gw-${RUN}`,
      topics: {
        position: POSITION_TOPIC,
        alarm: ALARM_TOPIC,
        device: DEVICE_TOPIC,
        commandAck: ACK_TOPIC,
        session: SESSION_TOPIC,
      },
    });
    const sessions = new SessionManager(null, gatewayProducer, `sprinte-pod-${RUN}`, {
      tcpTtlSeconds: 60,
      udpTtlSeconds: 30,
    });
    dispatcher = new PacketDispatcher({
      authResolver,
      sessionManager: sessions,
      kafka: gatewayProducer,
      rawStorage: new RawPacketStorage(),
    });
    session = DeviceSessionOpener.open({
      transport: 'tcp',
      protocolId: 'e2e',
      remoteAddress: '127.0.0.1',
      remotePort: 5111,
      instanceId: `sprinte-pod-${RUN}`,
    });

    // ── gps-engine leg (same composition as the Sprint D E2E) ───────────────
    const gpsConfig = {
      GPS_KAFKA_BROKERS: KAFKA_BROKERS.join(','),
      GPS_KAFKA_CLIENT_ID: `sprinte-${RUN}`,
      GPS_KAFKA_GROUP_ID: GROUP_ID,
      GPS_KAFKA_POSITION_TOPIC: POSITION_TOPIC,
      GPS_KAFKA_SESSION_TOPIC: SESSION_TOPIC,
      GPS_KAFKA_MAX_ATTEMPTS: 2,
      GPS_KAFKA_RETRY_BACKOFF_MS: 100,
      GPS_STALE_AFTER_SECONDS: 300,
      GPS_FUTURE_THRESHOLD_SECONDS: 60,
      GPS_REPORT_INTERVAL_SECONDS: 60,
      GPS_LAST_SEEN_FLUSH_SECONDS: 3600,
      GPS_TRIP_START_SPEED_KMH: 10,
      GPS_TRIP_START_DURATION_S: 30,
      GPS_TRIP_MIN_DISTANCE_M: 250,
      GPS_TRIP_STOP_SPEED_KMH: 3,
      GPS_TRIP_MIN_STOP_DURATION_S: 300,
      GPS_TRIP_MAX_GAP_S: 600,
      GPS_IDLE_SPEED_KMH: 1,
      GPS_IDLE_THRESHOLD_S: 180,
      GPS_IDLE_ALERT_THRESHOLD_S: 900,
      GPS_PARKING_THRESHOLD_S: 1800,
      GPS_MILEAGE_DEDUPE_DISTANCE_M: 1,
      GPS_MILEAGE_MAX_SPEED_KMH: 300,
      GPS_WS_PORT: WS_PORT,
      GPS_WS_ENABLED: true,
      GPS_WS_CORS_ORIGIN: '',
      GPS_WS_COALESCE_INTERVAL_MS: 0,
      GPS_WS_MAX_ROOMS_PER_CLIENT: 10,
    } as unknown as GpsEngineConfig;

    const positionRepo = new PositionRepository(knex as never);
    const tripRepo = new TripRepository(knex as never);
    statusRepo = new DeviceStatusRepository(knex as never);
    const memCache = {
      prev: null as unknown,
      latest: null as unknown,
      async getPrevPos() {
        return this.prev;
      },
      async setPrevPos(p: unknown) {
        this.prev = p;
      },
      async setLatest(p: unknown) {
        this.latest = p;
      },
      async getLatest() {
        return this.latest;
      },
    };
    const fsmCache = {
      store: new Map<string, unknown>(),
      async get(t: string, v: string, k: string) {
        return this.store.get(`${t}:${v}:${k}`) ?? null;
      },
      async set(t: string, v: string, k: string, val: unknown) {
        this.store.set(`${t}:${v}:${k}`, val);
      },
      async getNumber() {
        return 0;
      },
      async setNumber() {},
    };
    const signalBus = new SignalBus();
    const tripEngine = new TripEngine({
      config: gpsConfig,
      fsmCache: fsmCache as never,
      positionCache: memCache as never,
      tripRepo,
      signalBus,
    });
    const positionPipeline = new PositionPipeline({
      config: gpsConfig,
      positions: positionRepo,
      cache: memCache as never,
      signalBus,
      tripEngine,
      deviceStatus: statusRepo,
    });
    const statusPipeline = new DeviceStatusPipeline({
      statusRepo,
      statusCache: { async setStatus() {}, async getStatus() {} } as never,
      signalBus,
    });
    const dlq = new DlqProducer({
      brokers: KAFKA_BROKERS,
      clientId: `sprinte-dlq-${RUN}`,
      groupId: GROUP_ID,
    });
    const GpsConsumer = GpsEngineKafkaConsumer as unknown as new (
      o: unknown,
    ) => {
      onApplicationBootstrap: () => Promise<void>;
      onApplicationShutdown: () => Promise<void>;
      isRunning: boolean;
    };
    consumer = new GpsConsumer({
      config: gpsConfig,
      positionPipeline,
      deviceStatusPipeline: statusPipeline,
      dlq,
    });

    // ── websocket leg: verifies the IDENTITY-ISSUED token (§30 step 14) ─────
    wsGateway = new RealtimeGateway({
      config: gpsConfig,
      redis: null,
      signalBus,
      jwt: new JwtService({ secret: JWT_SECRET }),
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    await wsGateway.onApplicationBootstrap();
    await new Promise((r) => setTimeout(r, 200));
    await (kafkaCtx as { producer: Producer }).producer.connect();
    await consumer.onApplicationBootstrap();
    await waitFor(async () => (consumer.isRunning ? true : null), { what: 'consumer start' });
  }, 120_000);

  afterAll(async () => {
    await consumer?.onApplicationShutdown().catch(() => {});
    await wsGateway?.onApplicationShutdown().catch(() => {});
    await gatewayProducer?.onApplicationShutdown().catch(() => {});
    fleetProc?.kill('SIGTERM');
    await new Promise((r) => {
      if (fleetProc?.exitCode !== null) return r(null);
      fleetProc?.once('exit', () => r(null));
      setTimeout(r, 5_000);
    });
    if (kafkaCtx) {
      await kafkaCtx.admin
        .deleteTopics({ topics: [POSITION_TOPIC, SESSION_TOPIC, DEVICE_TOPIC] })
        .catch(() => {});
      await kafkaCtx.admin.disconnect().catch(() => {});
      await kafkaCtx.consumer.disconnect().catch(() => {});
      await kafkaCtx.producer.disconnect().catch(() => {});
    }
    if (knex) {
      const { createKnex } = await import('@fleetvision/persistence-knex');
      const admin = await createKnex({ url: ADMIN_URL });
      await knex.destroy();
      await admin.raw(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEST_DB}'`,
      );
      await admin.raw(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
      await admin.destroy();
    }
  }, 120_000);

  // ── §30 steps 1–6: login → fleet → vehicle → device → bind (real HTTP) ────

  it('1–6. real login → create fleet/vehicle/device → assign → registry wire + summary', async () => {
    expect(token).toBeTruthy();
    expect(tenantId).toBeTruthy();

    const fleetRes = await fleetHttp('/api/v1/fleets', {
      method: 'POST',
      body: JSON.stringify({ name: 'Sprint E Fleet', code: `SPRE${RUN.slice(-5)}` }),
    });
    expect(fleetRes.status).toBe(201);
    fleetId = ((await fleetRes.json()) as { data: { id: string } }).data.id;

    const vehicleRes = await fleetHttp('/api/v1/vehicles', {
      method: 'POST',
      body: JSON.stringify({
        fleetId,
        name: 'E2E Truck',
        code: `VE${RUN.slice(-5)}`,
        plate: 'E2E-001',
      }),
    });
    expect(vehicleRes.status).toBe(201);
    vehicleId = ((await vehicleRes.json()) as { data: { id: string } }).data.id;

    imei = luhnImei(7);
    const deviceRes = await fleetHttp('/api/v1/devices', {
      method: 'POST',
      body: JSON.stringify({
        imei,
        manufacturer: 'Teltonika',
        model: 'FMB920',
        protocol: 'stub',
        // The gateway authenticates only ACTIVE devices (UNPAIRED rejects).
        status: 'ACTIVE',
      }),
    });
    expect(deviceRes.status).toBe(201);
    deviceId = ((await deviceRes.json()) as { data: { id: string } }).data.id;

    const bindRes = await fleetHttp(`/api/v1/vehicles/${vehicleId}/devices/${deviceId}`, {
      method: 'POST',
      body: JSON.stringify({ role: 'TRACKER', isPrimary: true }),
    });
    expect(bindRes.status).toBe(201);

    // §11: the device list wire carries the bound vehicleId (Sprint E addition).
    const listRes = await fleetHttp('/api/v1/devices?limit=200');
    const listed = (
      (await listRes.json()) as { data: Array<{ id: string; vehicleId: string | null }> }
    ).data;
    expect(listed.find((x) => x.id === deviceId)?.vehicleId).toBe(vehicleId);

    // §21: the dashboard summary aggregates real counts.
    const summaryRes = await fleetHttp('/api/v1/summary');
    expect(summaryRes.status).toBe(200);
    const summary = (await summaryRes.json()) as {
      data: { vehicles: { active: number }; devices: { total: number } };
    };
    expect(summary.data.vehicles.active).toBeGreaterThanOrEqual(1);
    expect(summary.data.devices.total).toBeGreaterThanOrEqual(1);
  });

  // ── §30 steps 7–17: telemetry → kafka → gps → WS (identity token) ─────────

  it('7–17. LOGIN+POSITION frames → ONLINE + WS position.update under the REGISTRY vehicleId', async () => {
    // The dashboard's WS client — authenticated with the IDENTITY-ISSUED token.
    const client = await wsConnect(token);
    await new Promise<void>((resolve) =>
      client.emit('subscribe', `tenant:${tenantId}:fleet`, (ack: { ok: boolean }) => {
        expect(ack.ok).toBe(true);
        resolve();
      }),
    );

    const statusEvent = nextEvent<{ state: string }>(
      client,
      'device.status',
      (e) => e.state === 'ONLINE',
    );
    const positionEvent = nextEvent<{ vehicleId: string; tenantId: string }>(
      client,
      'position.update',
      () => true,
    );

    if (session.state === 'NEW') session.identify(new Date());
    const loginResult = (await dispatcher.dispatch(
      session,
      simAdapter(),
      simFrame(0x01, imei),
    )) as { published: number; close: boolean; closeReason: string | null };
    // eslint-disable-next-line no-console
    console.log('[sprinte e2e] LOGIN dispatch:', JSON.stringify(loginResult));
    const online = await statusEvent;
    expect(online.state).toBe('ONLINE');

    await dispatcher.dispatch(session, simAdapter(), simFrame(0x10, '35.7,51.4,42'));
    const signal = await positionEvent;
    expect(signal.vehicleId).toBe(vehicleId); // registry-sourced, never deviceId
    client.close();

    // The live map's bootstrap: latest-per-vehicle + status list (one call each).
    const positionsController = new PositionsController(
      { getLatest: async () => null } as never,
      new PositionRepository(knex as never),
      { HISTORY_MAX_RANGE_DAYS: 31 } as never,
      null as never,
    );
    const latest = await positionsController.latestForTenant(tenantId);
    const mine = latest.find((p) => p.vehicleId === vehicleId);
    expect(mine?.latitude).toBeCloseTo(35.7, 4);
    expect(mine?.longitude).toBeCloseTo(51.4, 4);

    const statusController = new DeviceStatusController(
      { getStatus: async () => null } as never,
      statusRepo,
    );
    const statuses = await statusController.list(tenantId);
    const status = statuses.find((s) => s.deviceId === deviceId);
    expect(status?.state).toBe('ONLINE');
    expect(status?.lastSeenAt).toBeTruthy(); // §19: backend-provided last-seen
  }, 60_000);

  // ── §29: tenant isolation on the WS path (tenant-B token, same secret) ─────

  it('§29 tenant isolation: a tenant-B client cannot subscribe tenant-A rooms', async () => {
    const jwt = new JwtService({ secret: JWT_SECRET });
    const tokenB = jwt.sign(
      { sub: 'tenant-b-user', tenant_id: TENANT_B },
      { issuer: JWT_ISSUER, audience: JWT_AUDIENCE, algorithm: 'HS256' },
    );
    const client = await wsConnect(tokenB);
    const ack = await new Promise<{ ok: boolean; error?: string }>((resolve) =>
      client.emit('subscribe', `tenant:${tenantId}:fleet`, (a: { ok: boolean; error?: string }) =>
        resolve(a),
      ),
    );
    expect(ack.ok).toBe(false);
    client.close();
  });

  // ── §30 steps 18–21: disconnect → OFFLINE → reconnect → ONLINE ─────────────

  it('18–21. DISCONNECT → OFFLINE (WS + projection) → reconnect → ONLINE', async () => {
    const client = await wsConnect(token);
    await new Promise<void>((resolve) =>
      client.emit('subscribe', `tenant:${tenantId}:fleet`, () => resolve()),
    );
    const offlineEvent = nextEvent<{ state: string }>(
      client,
      'device.status',
      (e) => e.state === 'OFFLINE',
    );

    await gatewayProducer.publishSessionLifecycle({
      sessionId: session.id,
      deviceId,
      tenantId,
      state: 'DISCONNECTED',
      reason: 'client_closed',
      protocolId: 'e2e',
      at: new Date(),
    });
    const offline = await offlineEvent;
    expect(offline.state).toBe('OFFLINE');

    const statusController = new DeviceStatusController(
      { getStatus: async () => null } as never,
      statusRepo,
    );
    const afterOffline = await waitFor(
      async () => {
        const rows = await statusController.list(tenantId);
        const row = rows.find((s) => s.deviceId === deviceId);
        return row?.state === 'OFFLINE' ? row : null;
      },
      { what: 'device OFFLINE projection' },
    );
    expect(afterOffline.state).toBe('OFFLINE');

    // Reconnect: a fresh LOGIN frame brings the device ONLINE again (§30 step 21).
    const onlineEvent = nextEvent<{ state: string }>(
      client,
      'device.status',
      (e) => e.state === 'ONLINE',
    );
    await dispatcher.dispatch(session, simAdapter(), simFrame(0x01, imei));
    const online = await onlineEvent;
    expect(online.state).toBe('ONLINE');
    client.close();
  }, 60_000);
});

/** Wait for the next socket event matching `match` (skips non-matching ones). */
function nextEvent<T>(client: Socket, event: string, match: (payload: T) => boolean): Promise<T> {
  return new Promise((resolve) => {
    const onEvent = (payload: T) => {
      if (match(payload)) {
        client.off(event, onEvent);
        resolve(payload);
      }
    };
    client.on(event, onEvent);
  });
}
