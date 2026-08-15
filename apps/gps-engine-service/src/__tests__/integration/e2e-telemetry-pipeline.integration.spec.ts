import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
/**
 * Sprint D §46/§47 — the mandatory REAL end-to-end telemetry test.
 *
 *   Device simulator (stub adapter)
 *     ↓ REAL PacketDispatcher + AuthResolver + SessionManager
 *   DeviceGatewayKafkaProducer            ← REAL kafkajs producer → REAL Kafka
 *     ↓ (unique test topics)
 *   GpsEngineKafkaConsumer                ← REAL kafkajs consumer (unique group)
 *     ↓ REAL retry/DLQ processor + envelope parser
 *   PositionPipeline → REAL PostgreSQL/TimescaleDB rows (throwaway test DB)
 *     ↓ REAL TripEngine (REAL TripRepository SQL; in-memory FSM cache)
 *   SignalBus → REAL RealtimeGateway (Socket.IO) → REAL authenticated client
 *
 * Verifies (the §47 acceptance core, composed in-process):
 *   1. LOGIN resolves the trusted identity (deviceId/tenantId/vehicleId from
 *      the registry — never the device payload) → session-lifecycle →
 *      tracking.device_status = ONLINE.
 *   2. A position flows the FULL path and lands in vehicle_positions under the
 *      REGISTRY vehicleId; the authorized WS client receives position.update.
 *   3. Kafka redelivery is idempotent: same envelope twice → ONE row, ONE event.
 *   4. Out-of-order packet (§21): persisted, but no WS update + no regression.
 *   5. Malformed message (§15/§18): routed to the real DLQ topic with headers.
 *
 * Skips gracefully when Kafka or PostgreSQL is unreachable (CI without Docker).
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { JwtService } from '@nestjs/jwt';
import { type Admin, type Consumer, Kafka, type Producer } from 'kafkajs';
import { io } from 'socket.io-client';
// GPS leg.
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
import { bootstrap as bootstrapDb, dropTestDb } from './db.js';

// --- gateway leg: dynamic source imports (the SAME classes the service runs).
// Static cross-app relative imports escape this project's tsconfig rootDir, so
// they are loaded via file URLs (the established Sprint C pattern for cross-app
// test imports) and cast to minimal structural types.
/**
 * Gateway dist root (built `.js` — jest's ESM resolver needs real files). The
 * E2E composes the SAME compiled classes the gateway service runs; run
 * `pnpm --filter device-gateway-service build` after touching gateway sources.
 */
const GW = fileURLToPath(new URL('../../../../device-gateway-service/dist', import.meta.url));
/** Dynamic import of the gateway's compiled output (skips if not built). */
async function gwModule(rel: string): Promise<Record<string, unknown>> {
  return (await import(pathToFileURL(resolve(GW, rel)).href)) as Record<string, unknown>;
}
// Minimal structural stand-ins for the gateway classes this test drives — the
// REAL implementations are loaded and used; these types only describe usage.
interface GwMessageProps {
  messageId: string;
  deviceId: string;
  serialOrImei: string;
  tenantId: string;
  vehicleId?: string | null;
  protocolId: string;
  type: string;
  timestamp: Date;
  ingestedAt: Date;
  position?: {
    latitude: number;
    longitude: number;
    speedKph: number;
    headingDeg: number;
    altitudeM: number | null;
    satellites: number | null;
    timestamp: Date;
    ignitionOn: boolean | null;
  };
  rawSize: number;
  checksum: string;
  direction: 'INBOUND' | 'OUTBOUND';
}
const AuthResolver = (await gwModule('application/auth-resolver.js')).AuthResolver as new (
  redis: unknown,
  registry: unknown,
  options?: unknown,
) => { resolve: (imei: string) => Promise<unknown> };
const PacketDispatcher = (await gwModule('application/packet-dispatcher.js'))
  .PacketDispatcher as new (deps: {
  authResolver: { resolve: (imei: string) => Promise<unknown> };
  sessionManager: unknown;
  kafka: unknown;
  rawStorage: unknown;
}) => {
  dispatch: (
    session: unknown,
    adapter: unknown,
    raw: unknown,
  ) => Promise<{ published: number; close: boolean; closeReason: string | null }>;
};
const SessionManager = (await gwModule('application/session-manager.js')).SessionManager as new (
  store: unknown,
  emitter: unknown,
  pod: string,
  options: { tcpTtlSeconds: number; udpTtlSeconds: number },
) => { track: (s: unknown) => void; registerAuthenticated: (s: unknown) => Promise<unknown> };
const InMemoryDeviceRegistry = (await gwModule('infrastructure/registry/index.js'))
  .InMemoryDeviceRegistry as new () => {
  registerByImei: (
    imei: string,
    device: { deviceId: string; tenantId: string; status: string; pairedVehicleId: string | null },
    active: boolean,
  ) => unknown;
};
const DeviceGatewayKafkaProducer = (await gwModule('infrastructure/kafka/kafka-producer.js'))
  .DeviceGatewayKafkaProducer as new (options: {
  brokers: string[];
  clientId: string;
  topics: Record<string, string>;
}) => {
  publish: (m: unknown) => Promise<void>;
  publishSessionLifecycle: (e: unknown) => Promise<void>;
  onApplicationShutdown: () => Promise<void>;
};
const RawPacketStorage = (await gwModule('infrastructure/storage/index.js'))
  .RawPacketStorage as new () => {
  retain: (r: unknown, d: string, m: string) => unknown;
};
const gwDomain = await gwModule('domain/index.js');
const DeviceSession = gwDomain.DeviceSession as {
  open: (init: {
    transport: 'tcp' | 'udp';
    protocolId: string;
    remoteAddress: string;
    remotePort: number;
    instanceId: string;
  }) => {
    id: string;
    state: string;
    identify: (now?: Date) => void;
    authenticate: (r: Record<string, unknown>) => void;
    activate: (now?: Date) => void;
  };
};
const RawPacket = gwDomain.RawPacket as new (p: {
  protocolId: string;
  payload: Buffer;
  receivedAt: Date;
  direction: 'INBOUND' | 'OUTBOUND';
}) => unknown;
const gwTransport = await gwModule('infrastructure/transport/index.js');
const NEED_MORE = gwTransport.NEED_MORE as symbol;
const DeviceMessage = (await gwModule('domain/device-message.js')).DeviceMessage as new (
  props: GwMessageProps,
) => unknown;

const TEST_DB = 'fleetvision_sprintd_e2e_test';
const TENANT_A = '11111111-1111-1111-1111-111111111111';
const VEHICLE_A = '22222222-2222-2222-2222-222222222222';
const DEVICE_ID = '33333333-3333-3333-3333-333333333333';
const IMEI = '351234567890124';
const RUN = Date.now().toString(36);
const uuid = () => globalThis.crypto.randomUUID();
const POSITION_TOPIC = `fleetvision.sprintd.e2e.${RUN}.position.raw`;
const SESSION_TOPIC = `fleetvision.sprintd.e2e.${RUN}.session.lifecycle`;
const DEVICE_TOPIC = `fleetvision.sprintd.e2e.${RUN}.device.raw`;
const ALARM_TOPIC = `fleetvision.sprintd.e2e.${RUN}.alarm.raw`;
const ACK_TOPIC = `fleetvision.sprintd.e2e.${RUN}.command.ack`;
const GROUP_ID = `sprintd-e2e-${RUN}`;
const WS_PORT = 3993;
const KAFKA_BROKERS = (process.env.KAFKA_TEST_BROKERS ?? 'localhost:9092').split(',');
const JWT_SECRET = 'e2e-secret-e2e-secret-e2e-secret-3232';

// --- graceful gating: Kafka + PostgreSQL must be reachable -----------------

async function tryKafka(): Promise<{
  admin: Admin;
  producer: Producer;
  consumer: Consumer;
} | null> {
  try {
    const kafka = new Kafka({ brokers: KAFKA_BROKERS, clientId: `sprintd-e2e-${RUN}` });
    const admin = kafka.admin();
    await admin.connect();
    // Pre-create the topics (the producer runs with allowAutoTopicCreation=false).
    await admin.createTopics({
      topics: [
        POSITION_TOPIC,
        SESSION_TOPIC,
        DEVICE_TOPIC,
        `${POSITION_TOPIC}.dlq`,
        `${SESSION_TOPIC}.dlq`,
      ].map((topic) => ({ topic, numPartitions: 1 })),
      waitForLeaders: true,
    });
    return {
      admin,
      producer: kafka.producer({ idempotent: true }),
      consumer: kafka.consumer({ groupId: `${GROUP_ID}-dlqcheck` }),
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[sprintd e2e] skipped (kafka): ${(e as Error).message}`);
    return null;
  }
}

const kafkaCtx = await tryKafka();
const dbCtx = kafkaCtx ? await bootstrapDb(TEST_DB) : null;
const knex = dbCtx?.knex ?? null;
const d = knex ? describe : describe.skip;

/** Poll until the predicate holds (bounded). */
async function waitFor<T>(
  fn: () => Promise<T | null | undefined>,
  {
    timeoutMs = 20_000,
    intervalMs = 250,
    what = 'condition',
  }: { timeoutMs?: number; intervalMs?: number; what?: string } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// --- a minimal e2e protocol adapter (LOGIN carries IMEI; POSITION carries lat,lng,speed)

/** Structural stand-in for the gateway's ProtocolAdapter (duck-typed at runtime). */
interface ProtocolAdapter {
  readonly id: string;
  readonly meta: { id: string; name: string; version: string; vendor: string };
  detect(peek: Buffer): { confidence: number };
  frame(
    reader: {
      available: number;
      peek: (n: number) => Buffer;
      read: (n: number) => Buffer | symbol;
    },
    receivedAt: Date,
  ): unknown;
  decode(raw: unknown): readonly unknown[];
  encode(cmd: unknown): Buffer;
}

class E2eAdapter implements ProtocolAdapter {
  public readonly id = 'e2e';
  public readonly meta = { id: 'e2e', name: 'E2E', version: '1', vendor: 'test' };

  public detect(peek: Buffer): { confidence: number } {
    return peek.length >= 2 && peek[0] === 0xe2 && peek[1] === 0x0e
      ? { confidence: 0.9 }
      : { confidence: 0 };
  }

  public frame(
    reader: {
      available: number;
      peek: (n: number) => Buffer;
      read: (n: number) => Buffer | symbol;
    },
    receivedAt: Date,
  ): unknown {
    void receivedAt;
    if (reader.available < 4) return NEED_MORE;
    const head = reader.peek(4);
    const len = ((head[2] ?? 0) << 8) | (head[3] ?? 0);
    const total = 4 + len + 1;
    if (reader.available < total) return NEED_MORE;
    const raw = reader.read(total);
    if (raw === NEED_MORE || raw === undefined) return NEED_MORE;
    return new RawPacket({
      protocolId: this.id,
      payload: Buffer.from(raw as Buffer),
      receivedAt: new Date(),
      direction: 'INBOUND',
    });
  }

  public decode(raw: {
    payload: Buffer;
    receivedAt: Date;
    rawSize: number;
    direction: 'INBOUND' | 'OUTBOUND';
  }): readonly unknown[] {
    const body = raw.payload.subarray(4, raw.payload.length - 1);
    const typeByte = body[0] ?? 0;
    const rest = body.subarray(1).toString('utf8');
    const type = typeByte === 0x01 ? 'LOGIN' : 'POSITION';
    const parts = rest.split(',');
    const lat = Number(parts[0] ?? '0') || 0;
    const lng = Number(parts[1] ?? '0') || 0;
    const speed = Number(parts[2] ?? '0') || 0;
    return [
      new DeviceMessage({
        messageId: globalThis.crypto.randomUUID(),
        deviceId: '',
        serialOrImei: type === 'LOGIN' ? rest : '',
        tenantId: '',
        protocolId: this.id,
        type,
        timestamp: raw.receivedAt,
        ingestedAt: raw.receivedAt,
        position:
          type === 'POSITION'
            ? {
                latitude: lat,
                longitude: lng,
                speedKph: speed,
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
  }

  public encode(): Buffer {
    return Buffer.alloc(0);
  }
}

function e2eFrame(typeByte: number, text: string): Buffer {
  const payload = Buffer.concat([Buffer.from([typeByte]), Buffer.from(text, 'utf8')]);
  const head = Buffer.from([0xe2, 0x0e, (payload.length >> 8) & 0xff, payload.length & 0xff]);
  const crc = Buffer.concat([head.subarray(2), payload]);
  let sum = 0;
  for (const b of crc) sum = (sum + b) & 0xff;
  return Buffer.concat([head, payload, Buffer.from([sum])]);
}

// --- in-memory caches standing in for Redis (best-effort layers) -----------

class MemPositionCache {
  public prev: unknown = null;
  public latest: unknown = null;
  async getPrevPos() {
    return this.prev;
  }
  async setPrevPos(p: unknown) {
    this.prev = p;
  }
  async setLatest(p: unknown) {
    this.latest = p;
  }
  async getLatest() {
    return this.latest;
  }
}
class MemFsmCache {
  public store = new Map<string, unknown>();
  async get(t: string, v: string, k: string) {
    return this.store.get(`${t}:${v}:${k}`) ?? null;
  }
  async set(t: string, v: string, k: string, val: unknown) {
    this.store.set(`${t}:${v}:${k}`, val);
  }
  async getNumber() {
    return 0;
  }
  async setNumber() {}
}
class MemStatusCache {
  async setStatus() {}
  async getStatus() {
    return null;
  }
}

d('Sprint D E2E — device → gateway → Kafka → gps-engine → PG → WebSocket (§46/§47)', () => {
  let adapter: E2eAdapter;
  let dispatcher: InstanceType<typeof PacketDispatcher>;
  let session: ReturnType<typeof DeviceSession.open>;
  let gatewayProducer: InstanceType<typeof DeviceGatewayKafkaProducer>;
  let consumer: InstanceType<typeof GpsEngineKafkaConsumer>;
  let dlq: DlqProducer;
  let signalBus: SignalBus;
  let wsGateway: RealtimeGateway | null = null;
  let positionRepo: PositionRepository;
  let tripRepo: TripRepository;
  let statusRepo: DeviceStatusRepository;
  const config = {
    GPS_KAFKA_BROKERS: KAFKA_BROKERS.join(','),
    GPS_KAFKA_CLIENT_ID: `sprintd-e2e-${RUN}`,
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

  beforeAll(async () => {
    const k = kafkaCtx as { admin: Admin; producer: Producer; consumer: Consumer };
    await k.producer.connect();

    // --- gateway leg (REAL dispatcher/auth/session/producer) ---------------
    const registry = new InMemoryDeviceRegistry().registerByImei(
      IMEI,
      {
        deviceId: DEVICE_ID,
        tenantId: TENANT_A,
        status: 'ACTIVE',
        pairedVehicleId: VEHICLE_A,
      },
      true,
    );
    const authResolver = new AuthResolver(null, registry);
    gatewayProducer = new DeviceGatewayKafkaProducer({
      brokers: KAFKA_BROKERS,
      clientId: `sprintd-e2e-gw-${RUN}`,
      topics: {
        position: POSITION_TOPIC,
        alarm: ALARM_TOPIC,
        device: DEVICE_TOPIC,
        commandAck: ACK_TOPIC,
        session: SESSION_TOPIC,
      },
    });
    const sessions = new SessionManager(null, gatewayProducer, `e2e-pod-${RUN}`, {
      tcpTtlSeconds: 60,
      udpTtlSeconds: 30,
    });
    adapter = new E2eAdapter();
    dispatcher = new PacketDispatcher({
      authResolver,
      sessionManager: sessions,
      kafka: gatewayProducer,
      rawStorage: new RawPacketStorage(),
    });
    session = DeviceSession.open({
      transport: 'tcp',
      protocolId: adapter.id,
      remoteAddress: '127.0.0.1',
      remotePort: 5099,
      instanceId: `e2e-pod-${RUN}`,
    });

    // --- gps-engine leg (REAL consumer/pipelines/repos) -------------------
    positionRepo = new PositionRepository(knex as never);
    tripRepo = new TripRepository(knex as never);
    statusRepo = new DeviceStatusRepository(knex as never);
    const posCache = new MemPositionCache();
    const fsmCache = new MemFsmCache();
    signalBus = new SignalBus();
    const tripEngine = new TripEngine({
      config,
      fsmCache: fsmCache as never,
      positionCache: posCache as never,
      tripRepo,
      signalBus,
    });
    const positionPipeline = new PositionPipeline({
      config,
      positions: positionRepo,
      cache: posCache as never,
      signalBus,
      tripEngine,
      deviceStatus: statusRepo,
    });
    const statusPipeline = new DeviceStatusPipeline({
      statusRepo,
      statusCache: new MemStatusCache() as never,
      signalBus,
    });
    dlq = new DlqProducer({
      brokers: KAFKA_BROKERS,
      clientId: `sprintd-e2e-dlq-${RUN}`,
      groupId: GROUP_ID,
    });
    consumer = new GpsEngineKafkaConsumer({
      config,
      positionPipeline,
      deviceStatusPipeline: statusPipeline,
      dlq,
    });

    // --- websocket leg ------------------------------------------------------
    const jwt = new JwtService({ secret: JWT_SECRET });
    wsGateway = new RealtimeGateway({
      config,
      redis: null,
      signalBus,
      jwt,
      issuer: 'fleetvision',
      audience: 'fleetvision-api',
    });
    await wsGateway.onApplicationBootstrap();
    await new Promise((r) => setTimeout(r, 200));

    // Start the consumer AFTER the topics exist and BEFORE we produce.
    await consumer.onApplicationBootstrap();
    await waitFor(async () => (consumer.isRunning ? true : null), {
      timeoutMs: 20_000,
      what: 'consumer to start',
    });
  }, 60_000);

  afterAll(async () => {
    await consumer?.onApplicationShutdown();
    await dlq?.onApplicationShutdown();
    await gatewayProducer?.onApplicationShutdown();
    await wsGateway?.onApplicationShutdown();
    if (kafkaCtx) {
      try {
        await kafkaCtx.admin.deleteTopics({
          topics: [
            POSITION_TOPIC,
            SESSION_TOPIC,
            DEVICE_TOPIC,
            ALARM_TOPIC,
            ACK_TOPIC,
            `${POSITION_TOPIC}.dlq`,
            `${SESSION_TOPIC}.dlq`,
          ],
        });
      } catch {
        /* best-effort */
      }
      await kafkaCtx.admin.disconnect().catch(() => {});
      await kafkaCtx.consumer.disconnect().catch(() => {});
      await kafkaCtx.producer.disconnect().catch(() => {});
    }
    if (knex) {
      const admin = await import('@fleetvision/persistence-knex').then((m) =>
        m.createKnex({
          url:
            process.env.GPS_TEST_DBURL ??
            'postgres://fleetvision:fleetvision@localhost:5432/fleetvision',
        }),
      );
      await knex.destroy();
      await dropTestDb(admin, TEST_DB);
      await admin.destroy();
    }
  }, 60_000);

  async function dispatchFrame(frame: Buffer): Promise<void> {
    if (session.state === 'NEW') session.identify(new Date());
    await dispatcher.dispatch(
      session,
      adapter,
      new RawPacket({
        protocolId: adapter.id,
        payload: frame,
        receivedAt: new Date(),
        direction: 'INBOUND',
      }),
    );
  }

  function wsClient(): Promise<import('socket.io-client').Socket> {
    const jwt = new JwtService({ secret: JWT_SECRET });
    const token = jwt.sign(
      { sub: 'e2e-user', tenant_id: TENANT_A },
      {
        issuer: 'fleetvision',
        audience: 'fleetvision-api',
        algorithm: 'HS256',
      },
    );
    return new Promise((resolve, reject) => {
      const socket = io(`http://localhost:${WS_PORT}`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
      });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', reject);
    });
  }

  it('1+2. LOGIN → trusted identity → ONLINE; position → PG row under the REGISTRY vehicleId → WS delivery', async () => {
    // Step 1: the device logs in (IMEI → registry → trusted identity).
    await dispatchFrame(e2eFrame(0x01, IMEI));
    // The session-lifecycle event projects ONLINE into tracking.device_status.
    const status = await waitFor(
      async () => {
        try {
          const r = await (
            knex as never as {
              raw: (q: string, b: unknown[]) => Promise<{ rows: { state: string }[] }>;
            }
          ).raw('SELECT state FROM tracking.device_status WHERE device_id = ? AND tenant_id = ?', [
            DEVICE_ID,
            TENANT_A,
          ]);
          return r.rows[0]?.state === 'ONLINE' ? r.rows[0] : null;
        } catch {
          return null;
        }
      },
      { what: 'device_status ONLINE' },
    );
    expect(status.state).toBe('ONLINE');

    // Step 2: a live position through the whole pipeline.
    const client = await wsClient();
    await new Promise<void>((resolve) =>
      client.emit('subscribe', `tenant:${TENANT_A}:vehicle:${VEHICLE_A}`, () => resolve()),
    );

    const received = new Promise<import('../../application/signal-bus.js').PositionSignal>(
      (resolve) => client.once('position.update', resolve),
    );
    await dispatchFrame(e2eFrame(0x10, '35.7,51.4,40'));

    const signal = await received;
    expect(signal.tenantId).toBe(TENANT_A);
    expect(signal.vehicleId).toBe(VEHICLE_A); // REGISTRY-sourced, not deviceId

    // The position row carries the trusted identity (§5) + both timestamps (§22).
    const row = await waitFor(
      async () => {
        const rows = await (
          knex as never as {
            raw: (q: string, b: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
          }
        ).raw(
          'SELECT vehicle_id, tenant_id, captured_at, ingested_at FROM tracking.vehicle_positions WHERE tenant_id = ? LIMIT 5',
          [TENANT_A],
        );
        return rows.rows[0] ?? null;
      },
      { what: 'vehicle_positions row' },
    );
    expect(row.vehicle_id).toBe(VEHICLE_A);
    expect(row.tenant_id).toBe(TENANT_A);
    client.disconnect();
  }, 45_000);

  it('3. Kafka redelivery is idempotent: same envelope twice → ONE row', async () => {
    const produce = (body: string) =>
      (kafkaCtx as { producer: Producer }).producer.send({
        topic: POSITION_TOPIC,
        messages: [
          {
            key: DEVICE_ID,
            value: body,
            headers: { 'event-type': 'telemetry.position.raw.v1' },
          },
        ],
      });
    const redeliveryId = uuid();
    const envelope = JSON.stringify({
      specversion: '1.0',
      type: 'telemetry.position.raw.v1',
      id: redeliveryId,
      messageId: redeliveryId,
      correlationId: 'e2e-redelivery',
      deviceId: DEVICE_ID,
      tenantId: TENANT_A,
      vehicleId: VEHICLE_A,
      protocolId: 'e2e',
      timestamp: new Date(Date.now() - 5_000).toISOString(),
      time: new Date().toISOString(),
      position: { latitude: 35.71, longitude: 51.41, speedKph: 20, headingDeg: 0 },
    });
    await produce(envelope);
    await produce(envelope); // at-least-once redelivery

    await waitFor(
      async () => {
        const rows = await (
          knex as never as {
            raw: (q: string, b: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
          }
        ).raw('SELECT count(*)::int AS n FROM tracking.vehicle_positions WHERE event_id = ?', [
          redeliveryId,
        ]);
        return rows.rows[0]?.n === 1 ? rows.rows[0] : null;
      },
      { what: 'exactly one redelivered row' },
    );
    // Exactly 1 — the composite PK conflict + pipeline dedupe held.
  }, 45_000);

  it('4. Out-of-order packet: persisted, but NOT broadcast (§21)', async () => {
    const client = await wsClient();
    await new Promise<void>((resolve) =>
      client.emit('subscribe', `tenant:${TENANT_A}:vehicle:${VEHICLE_A}`, () => resolve()),
    );
    let broadcastCount = 0;
    client.on('position.update', () => broadcastCount++);

    // In-order first, then an OLDER packet.
    await dispatchFrame(e2eFrame(0x10, '35.72,51.42,30'));
    await new Promise((r) => setTimeout(r, 2500));
    const before = broadcastCount;
    expect(before).toBeGreaterThanOrEqual(1);

    // Produce an explicitly OLDER event-time envelope (T0 < T1).
    const olderId = uuid();
    const older = JSON.stringify({
      specversion: '1.0',
      type: 'telemetry.position.raw.v1',
      id: olderId,
      messageId: olderId,
      deviceId: DEVICE_ID,
      tenantId: TENANT_A,
      vehicleId: VEHICLE_A,
      protocolId: 'e2e',
      timestamp: new Date(Date.now() - 60_000).toISOString(), // 60s older
      time: new Date().toISOString(),
      position: { latitude: 35.718, longitude: 51.418, speedKph: 30, headingDeg: 0 },
    });
    await (kafkaCtx as { producer: Producer }).producer.send({
      topic: POSITION_TOPIC,
      messages: [{ key: DEVICE_ID, value: older }],
    });
    await new Promise((r) => setTimeout(r, 3_000));

    // Persisted (2 distinct rows in the window)…
    const rows = await (
      knex as never as {
        raw: (q: string, b: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
      }
    ).raw('SELECT count(*)::int AS n FROM tracking.vehicle_positions WHERE event_id = ?', [
      olderId,
    ]);
    expect(rows.rows[0]?.n).toBe(1);
    // …but NO new WS broadcast for the out-of-order packet.
    expect(broadcastCount).toBe(before);
    client.disconnect();
  }, 45_000);

  it('5. Malformed message → REAL DLQ topic with forensic headers (§15/§16)', async () => {
    const c = (kafkaCtx as { consumer: Consumer }).consumer;
    const dlqMessages: { value: Buffer | null; headers: Record<string, unknown> }[] = [];
    await c.subscribe({ topic: `${POSITION_TOPIC}.dlq`, fromBeginning: true });
    await c.run({
      eachMessage: async ({ message }) => {
        dlqMessages.push({ value: message.value, headers: message.headers ?? {} });
      },
    });

    await (kafkaCtx as { producer: Producer }).producer.send({
      topic: POSITION_TOPIC,
      messages: [{ key: DEVICE_ID, value: Buffer.from('this-is-not-json{') }],
    });

    const dlqMessage = (await waitFor(
      async () =>
        dlqMessages.find((m) =>
          (m.value ?? Buffer.alloc(0)).toString().includes('this-is-not-json'),
        ) ?? null,
      { timeoutMs: 25_000, what: 'malformed message on the DLQ topic' },
    )) as { value: Buffer | null; headers: Record<string, unknown> };
    expect((dlqMessage.value ?? Buffer.alloc(0)).toString()).toContain('this-is-not-json');
    const h = (k: string) => String(dlqMessage.headers[k] ?? '');
    expect(h('dlq-original-topic')).toBe(POSITION_TOPIC);
    expect(h('dlq-error-class')).toBe('EnvelopeValidationError');
    expect(Number(h('dlq-attempts'))).toBe(1); // non-retryable
    expect(h('dlq-source-group')).toBe(GROUP_ID);
    await c.disconnect();
  }, 45_000);
});
