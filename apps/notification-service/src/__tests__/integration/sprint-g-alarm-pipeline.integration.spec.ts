import { createRedisClient } from '@fleetvision/cache-redis';
import type { Redis } from '@fleetvision/cache-redis';
/**
 * Sprint G integration suite — the REAL alarm pipeline against live Docker
 * (Kafka + PostgreSQL + Redis), Part 42/43 acceptance scenarios:
 *
 *   Scenario 1 SPEEDING  — telemetry → Kafka → alarm engine → PostgreSQL:
 *                          80 km/h no alarm; 120 raises ONE OPEN alarm; more
 *                          speeding never duplicates; 80 auto-resolves.
 *   Scenario 2 GEOFENCE  — real PostGIS geofence (tracking.geofences); outside
 *                          → inside raises ONE enter alarm; staying inside
 *                          raises nothing more.
 *   Scenario 3 DEVICE    — session-lifecycle DISCONNECTED raises; reconnect
 *                          (ONLINE) auto-resolves; no alarm storm.
 *   Scenario 4 ISOLATION — tenant B never sees tenant A's alarms (listPage is
 *                          tenant-scoped).
 *
 * Graceful skip when the docker stack (Postgres/Kafka/Redis) is unreachable —
 * `pnpm test` stays green without Docker; this run is the real thing.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Kafka } from 'kafkajs';
import { AlarmEvaluatorService } from '../../application/alarm-evaluator.service.js';
import type { NotificationConfig } from '../../config/notification.config.js';
import { AlarmRule } from '../../domain/alarm-rule.js';
import { AlarmStateCache } from '../../infrastructure/cache/alarm-state-cache.js';
import { AlarmKafkaConsumer } from '../../infrastructure/kafka/alarm-kafka-consumer.js';
import { AlarmOccurrenceRepository } from '../../infrastructure/persistence/alarm-occurrence.repository.js';
import { AlarmRuleRepository } from '../../infrastructure/persistence/alarm-rule.repository.js';
import { FleetEventRepository } from '../../infrastructure/persistence/fleet-event.repository.js';
import { type IntegrationCtx, KAFKA_BROKERS, REDIS_URL, bootstrap, dropTestDb } from './db.js';

const DB = `notif_sprint_g_${Date.now().toString(36)}`;
const RUN = Date.now().toString(36);
const TENANT_A = 'aaaaaaa1-0000-4000-8000-000000000001';
const TENANT_B = 'aaaaaaa2-0000-4000-8000-000000000002';
const VEHICLE_A = 'bbbbbbb1-0000-4000-8000-000000000001';
const VEHICLE_B = 'bbbbbbb2-0000-4000-8000-000000000002';
const DEVICE_A = 'ccccccc1-0000-4000-8000-000000000001';

let ctx: IntegrationCtx | null = null;
let redis: Redis | null = null;
let producer: import('kafkajs').Producer | null = null;
let consumer: AlarmKafkaConsumer | null = null;
let alarmsRepo: AlarmOccurrenceRepository | null = null;
let rulesRepo: AlarmRuleRepository | null = null;
let fleetEventsRepo: FleetEventRepository | null = null;

const TOPIC_POS = `fleetvision.test.${RUN}.position.raw`;
const TOPIC_SESSION = `fleetvision.test.${RUN}.session.lifecycle`;
const TOPIC_TRACKING = `fleetvision.test.${RUN}.tracking.events`;

/** Wait until predicate resolves truthy (bounded polling). */
async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 20_000,
  intervalMs = 300,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return await predicate();
}

async function alarmsFor(tenant: string, type?: string) {
  const page = await alarmsRepo!.listPage(tenant, 100, {});
  return type ? page.data.filter((a) => a.type === type) : page.data;
}

beforeAll(async () => {
  ctx = await bootstrap(DB);
  if (!ctx) return;
  try {
    redis = createRedisClient({ url: REDIS_URL });
    await redis.ping();
  } catch {
    await ctx.knex.destroy();
    await ctx.admin.destroy();
    ctx = null;
    return;
  }
  // The test tenants use FIXED uuids; clear any stale dedup/geofence state in
  // the shared dev Redis from earlier runs (event-id dedup keys, geofence
  // inside-state) so every run starts from a clean alarm slate.
  for (const pattern of [`tenant:${TENANT_A}:*`, `tenant:${TENANT_B}:*`]) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  }
  try {
    const kafka = new Kafka({
      brokers: KAFKA_BROKERS.split(','),
      clientId: `sprint-g-test-${RUN}`,
    });
    producer = kafka.producer();
    await producer.connect();
  } catch {
    await redis.quit().catch(() => {});
    await ctx.knex.destroy();
    await ctx.admin.destroy();
    ctx = null;
    return;
  }

  alarmsRepo = new AlarmOccurrenceRepository(ctx.knex);
  rulesRepo = new AlarmRuleRepository(ctx.knex, null, 1);
  fleetEventsRepo = new FleetEventRepository(ctx.knex);

  const config = {
    NOTIF_KAFKA_BROKERS: KAFKA_BROKERS,
    NOTIF_KAFKA_CLIENT_ID: `sprint-g-test-${RUN}`,
    NOTIF_KAFKA_GROUP_ID: `sprint-g-test-${RUN}`,
    NOTIF_KAFKA_POSITION_TOPIC: TOPIC_POS,
    NOTIF_KAFKA_SESSION_TOPIC: TOPIC_SESSION,
    NOTIF_KAFKA_TRACKING_EVENT_TOPIC: TOPIC_TRACKING,
    NOTIF_KAFKA_MAX_ATTEMPTS: 2,
    NOTIF_KAFKA_RETRY_BACKOFF_MS: 100,
    NOTIF_KAFKA_CONSUMER_ENABLED: true,
    // Fresh topics + fresh group → consume everything, no assignment race.
    NOTIF_KAFKA_FROM_BEGINNING: true,
  } as unknown as NotificationConfig;

  const evaluator = new AlarmEvaluatorService({
    rules: rulesRepo,
    alarms: alarmsRepo,
    stateCache: new AlarmStateCache(redis),
    gateway: null,
    dispatcher: null,
    metrics: null,
  });
  consumer = new AlarmKafkaConsumer({
    config,
    evaluator,
    stateCache: new AlarmStateCache(redis),
    fleetEvents: fleetEventsRepo,
    dlq: null,
    metrics: null,
  });
  await consumer.onApplicationBootstrap();
}, 120_000);

afterAll(async () => {
  await consumer?.onApplicationShutdown().catch(() => {});
  await producer?.disconnect().catch(() => {});
  await redis?.quit().catch(() => {});
  if (!ctx) return;
  await ctx.knex.destroy();
  await dropTestDb(ctx.admin, DB);
  await ctx.admin.destroy();
});

// ── helpers ─────────────────────────────────────────────────────────────────

async function createRule(
  tenantId: string,
  type: string,
  conditions: Record<string, unknown>,
  entityId: string | null = null,
) {
  const rule = AlarmRule.create(undefined, {
    tenantId,
    name: `${type} rule`,
    type: type as never,
    severity: 'HIGH',
    enabled: true,
    entityType: 'vehicle',
    entityId,
    conditions,
    cooldownSec: 300,
    dedupWindowSec: 600,
    repeatPolicy: 'COOLDOWN',
  });
  await rulesRepo!.create(rule);
  return rule;
}

async function sendPosition(
  messageId: string,
  speedKph: number,
  lat: number,
  lng: number,
  tenantId = TENANT_A,
  vehicleId = VEHICLE_A,
) {
  // Run-unique messageId — deterministic idempotency key within the run, never
  // colliding with a previous run's Redis event-dedup keys.
  const id = `${RUN}:${messageId}`;
  await producer!.send({
    topic: TOPIC_POS,
    messages: [
      {
        key: DEVICE_A,
        value: JSON.stringify({
          specversion: '1.0',
          type: 'telemetry.position.raw.v1',
          id,
          messageId: id,
          deviceId: DEVICE_A,
          vehicleId,
          tenantId,
          protocolId: 'gt06',
          timestamp: new Date().toISOString(),
          position: { latitude: lat, longitude: lng, speedKph, headingDeg: 0 },
        }),
      },
    ],
  });
}

async function sendSession(state: string, tenantId = TENANT_A, deviceId = DEVICE_A) {
  await producer!.send({
    topic: TOPIC_SESSION,
    messages: [
      {
        key: deviceId,
        value: JSON.stringify({
          specversion: '1.0',
          type: 'telemetry.session.lifecycle.v1',
          id: `sess-${state}-${Date.now()}`,
          sessionId: `sess-${RUN}`,
          deviceId,
          tenantId,
          state,
          reason: 'test',
          protocolId: 'gt06',
          time: new Date().toISOString(),
        }),
      },
    ],
  });
}

/**
 * Sprint I — publish a gps-engine-style geofence FleetEvent (tracking.event.v1)
 * on the tracking topic. Detection now lives in the GPS Engine's evaluator;
 * this is exactly the envelope it produces.
 */
async function sendGeofenceEvent(
  messageType: 'geofence.entered' | 'geofence.exited' | 'geofence.dwell',
  geofenceId: string,
  opts: { dwellSec?: number | null; eventIdSuffix?: string; tenantId?: string; vehicleId?: string } = {},
) {
  const sourceEventId = `${RUN}:${messageType}:${geofenceId}:${opts.eventIdSuffix ?? '1'}`;
  const eventId = `${sourceEventId}:${messageType}:${geofenceId}`;
  await producer!.send({
    topic: TOPIC_TRACKING,
    messages: [
      {
        key: opts.vehicleId ?? VEHICLE_A,
        value: JSON.stringify({
          specversion: '1.0',
          type: 'tracking.event.v1',
          id: eventId,
          eventId,
          correlationId: sourceEventId,
          eventType: messageType,
          tenantId: opts.tenantId ?? TENANT_A,
          vehicleId: opts.vehicleId ?? VEHICLE_A,
          deviceId: null,
          occurredAt: new Date().toISOString(),
          severity: messageType === 'geofence.dwell' ? 'MEDIUM' : 'INFO',
          metadata: {
            sourceEventId,
            geofenceId,
            geofenceName: 'zone-a',
            dwellSec: opts.dwellSec ?? null,
            lat: 35.72,
            lng: 51.42,
          },
        }),
      },
    ],
  });
  return eventId;
}

// ── Scenarios ───────────────────────────────────────────────────────────────

describe('Sprint G acceptance — real Kafka → alarm engine → PostgreSQL', () => {
  it('skips when the docker stack is unreachable', () => {
    if (!ctx || !producer) return;
  });

  it('Scenario 1 — SPEEDING: raise once, never duplicate, auto-resolve', async () => {
    if (!ctx || !producer) return;
    await createRule(TENANT_A, 'overspeed', { thresholdKmh: 100 });

    // 4. speed=80 → 5. no alarm.
    await sendPosition('s1-a', 80, 35.7, 51.4);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await alarmsFor(TENANT_A, 'overspeed')).toHaveLength(0);

    // 6-8. speed=120 → SPEEDING alarm, ONE OPEN row.
    await sendPosition('s1-b', 120, 35.7, 51.4);
    expect(await waitFor(async () => (await alarmsFor(TENANT_A, 'overspeed')).length === 1)).toBe(
      true,
    );

    // 9-10. additional speeding packets → no duplicate OPEN alarms.
    for (let i = 0; i < 5; i++) {
      await sendPosition(`s1-c${i}`, 125, 35.7, 51.4);
    }
    await new Promise((r) => setTimeout(r, 2500));
    const afterStorm = await alarmsFor(TENANT_A, 'overspeed');
    expect(afterStorm).toHaveLength(1);
    expect(afterStorm[0]!.status).toBe('OPEN');

    // 11-12. speed back to 80 → auto-resolve.
    await sendPosition('s1-d', 80, 35.7, 51.4);
    expect(
      await waitFor(async () => {
        const alarms = await alarmsFor(TENANT_A, 'overspeed');
        return alarms[0]?.status === 'RESOLVED';
      }),
    ).toBe(true);
  }, 60_000);

  it('Scenario 2 — GEOFENCE ENTER (Sprint I event-driven): one event, one alarm, no duplicates', async () => {
    if (!ctx || !producer) return;
    // A real PostGIS geofence row (the id the rule + event reference; detection
    // itself now happens in the gps-engine evaluator — Sprint I).
    const ring: number[][] = [];
    for (let i = 0; i <= 48; i++) {
      const theta = (2 * Math.PI * i) / 48;
      ring.push([
        51.42 + (500 * Math.cos(theta)) / (111_320 * Math.cos((35.72 * Math.PI) / 180)),
        35.72 + (500 * Math.sin(theta)) / 111_320,
      ]);
    }
    const geofenceId = 'aaaaaab1-0000-4000-8000-000000000001';
    await ctx.knex.raw(
      `INSERT INTO tracking.geofences (id, tenant_id, name, geofence_type, boundary, center, radius_m, alert_on, metadata)
       VALUES (?::uuid, ?::uuid, 'zone-a', 'CIRCLE',
               ST_GeomFromGeoJSON(?)::geography,
               ?::geography, 500, ?, '{}')`,
      [
        geofenceId,
        TENANT_A,
        JSON.stringify({ type: 'Polygon', coordinates: [ring] }),
        'SRID=4326;POINT(51.42 35.72)',
        ['ENTER', 'EXIT'], // pg driver maps JS arrays → PG text[]
      ],
    );
    await createRule(TENANT_A, 'geofence_enter', { geofenceId });

    // The evaluator-confirmed ENTER arrives as a tracking FleetEvent.
    await sendGeofenceEvent('geofence.entered', geofenceId);
    expect(
      await waitFor(async () => (await alarmsFor(TENANT_A, 'geofence_enter')).length === 1),
    ).toBe(true);

    // Kafka redelivery of the SAME event (deterministic eventId) → suppressed.
    await sendGeofenceEvent('geofence.entered', geofenceId);
    // A LATER re-entry is a DIFFERENT event id — one-open dedup updates, not duplicates.
    await sendGeofenceEvent('geofence.entered', geofenceId, { eventIdSuffix: '2' });
    await new Promise((r) => setTimeout(r, 2500));
    expect(await alarmsFor(TENANT_A, 'geofence_enter')).toHaveLength(1);
  }, 60_000);

  it('Scenario 3 — DEVICE OFFLINE: raise on disconnect, resolve on reconnect, no storm', async () => {
    if (!ctx || !producer) return;
    await createRule(TENANT_A, 'device_offline', {});

    // Device connected → no alarm.
    await sendSession('AUTHENTICATED');
    await new Promise((r) => setTimeout(r, 1200));
    expect(await alarmsFor(TENANT_A, 'device_offline')).toHaveLength(0);

    // Connection drops → OFFLINE alarm.
    await sendSession('DISCONNECTED');
    expect(
      await waitFor(async () => (await alarmsFor(TENANT_A, 'device_offline')).length === 1),
    ).toBe(true);

    // Reconnect → auto-resolved + ONLINE produces no new alarm.
    await sendSession('AUTHENTICATED');
    expect(
      await waitFor(async () => {
        const alarms = await alarmsFor(TENANT_A, 'device_offline');
        return alarms[0]?.status === 'RESOLVED';
      }),
    ).toBe(true);
    await sendSession('AUTHENTICATED');
    await new Promise((r) => setTimeout(r, 1200));
    const offline = await alarmsFor(TENANT_A, 'device_offline');
    expect(offline).toHaveLength(1); // no storm
  }, 60_000);

  it('Scenario 4 — TENANT ISOLATION: B sees only B, never A', async () => {
    if (!ctx || !producer) return;
    // Tenant B rule + tenant B vehicle speeding → tenant B alarm.
    await createRule(TENANT_B, 'overspeed', { thresholdKmh: 100 });
    await sendPosition('t4-b', 150, 35.9, 51.9, TENANT_B, VEHICLE_B);
    expect(await waitFor(async () => (await alarmsFor(TENANT_B, 'overspeed')).length === 1)).toBe(
      true,
    );

    const alarmsA = await alarmsFor(TENANT_A);
    const alarmsB = await alarmsFor(TENANT_B);
    // A sees A only (its overspeed + geofence + offline alarms).
    expect(alarmsA.length).toBeGreaterThan(0);
    expect(alarmsA.every((a) => a.tenantId === TENANT_A)).toBe(true);
    // B sees exactly its own overspeed alarm — never A's.
    expect(alarmsB.every((a) => a.tenantId === TENANT_B)).toBe(true);
    expect(alarmsB).toHaveLength(1);
    // Cross-tenant id lookup returns nothing.
    const aAlarmId = alarmsA[0]!.id;
    expect(await alarmsRepo!.findById(TENANT_B, aAlarmId)).toBeNull();
  }, 60_000);

  it('FleetEvent idempotency — duplicate eventIds are suppressed + recorded once', async () => {
    if (!ctx || !producer) return;
    const event = {
      specversion: '1.0',
      type: 'tracking.event.v1',
      id: 'dup-1:trip.started',
      eventId: 'dup-1:trip.started',
      eventType: 'trip.started',
      tenantId: TENANT_A,
      vehicleId: VEHICLE_A,
      deviceId: null,
      occurredAt: new Date().toISOString(),
      severity: null,
      metadata: { durationSec: 0, distanceKm: 0, startedAt: new Date().toISOString() },
    };
    await producer.send({
      topic: TOPIC_TRACKING,
      messages: [
        { key: VEHICLE_A, value: JSON.stringify(event) },
        { key: VEHICLE_A, value: JSON.stringify(event) }, // exact duplicate (redelivery)
      ],
    });
    expect(
      await waitFor(async () =>
        (await fleetEventsRepo!.listPage(TENANT_A, 10, {})).data.some(
          (e) => e.id === 'dup-1:trip.started',
        ),
      ),
    ).toBe(true);
    await new Promise((r) => setTimeout(r, 1500));
    const rows = (await fleetEventsRepo!.listPage(TENANT_A, 10, {})).data.filter(
      (e) => e.id === 'dup-1:trip.started',
    );
    expect(rows).toHaveLength(1); // PK = eventId — recorded once
  }, 60_000);
});
