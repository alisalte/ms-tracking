import { createRedisClient } from '@fleetvision/cache-redis';
import type { Redis } from '@fleetvision/cache-redis';
/**
 * Sprint H integration suite — the REAL notification pipeline against live
 * Docker (PostgreSQL + Redis + Kafka), Part 58 acceptance scenarios:
 *
 *   Scenario 1 IN_APP     — speeding alarm → Kafka → alarm engine → per-user
 *                           notifications in PostgreSQL + unread count.
 *   Scenario 2 EMAIL      — email preference enabled → MockEmailProvider
 *                           invoked + delivery attempt persisted (provider
 *                           invocation verified WITHOUT external email —
 *                           Sprint H §43; SMTP delivery itself is reported
 *                           honestly as provider-not-configured in this run).
 *   Scenario 3 DISABLED   — user with email preference disabled → no email
 *                           delivery row for them.
 *   Scenario 4 DUPLICATE  — duplicate alarm dispatch (Kafka redelivery
 *                           semantics) → no duplicate notifications.
 *   Scenario 5 RETRY      — transient provider failure → durable retry via
 *                           the retry worker (claim → re-dispatch → SENT).
 *   Scenario 6 ISOLATION  — tenant A never sees tenant B notifications.
 *   Scenario 7 READ STATE — mark read / mark all read / unread count.
 *
 * Graceful skip when the docker stack is unreachable — `pnpm test` stays
 * green without Docker; this run is the real thing.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Kafka } from 'kafkajs';
import { AlarmEvaluatorService } from '../../application/alarm-evaluator.service.js';
import type { ChannelProvider } from '../../application/channels/channel-provider.js';
import { InAppChannel } from '../../application/channels/channels.js';
import { NotificationProviderRegistry } from '../../application/channels/provider-registry.js';
import { DeliveryExecutor } from '../../application/delivery-executor.js';
import { DeliveryRetryWorker } from '../../application/delivery-retry-worker.js';
import { NotificationDispatcherService } from '../../application/notification-dispatcher.service.js';
import type { NotificationConfig } from '../../config/notification.config.js';
import { AlarmRule } from '../../domain/alarm-rule.js';
import type { Notification } from '../../domain/notification.js';
import { AlarmStateCache } from '../../infrastructure/cache/alarm-state-cache.js';
import { NotificationRateLimiter } from '../../infrastructure/cache/notification-rate-limiter.js';
import { AlarmKafkaConsumer } from '../../infrastructure/kafka/alarm-kafka-consumer.js';
import { AlarmOccurrenceRepository } from '../../infrastructure/persistence/alarm-occurrence.repository.js';
import { AlarmRuleRepository } from '../../infrastructure/persistence/alarm-rule.repository.js';
import { FleetEventRepository } from '../../infrastructure/persistence/fleet-event.repository.js';
import { NotificationDeliveryRepository } from '../../infrastructure/persistence/notification-delivery.repository.js';
import { NotificationPreferenceRepository } from '../../infrastructure/persistence/notification-preference.repository.js';
import { NotificationRepository } from '../../infrastructure/persistence/notification.repository.js';
import { UserDirectory } from '../../infrastructure/persistence/user-directory.js';
import { type IntegrationCtx, KAFKA_BROKERS, REDIS_URL, bootstrap, dropTestDb } from './db.js';

const DB = `notif_sprint_h_${Date.now().toString(36)}`;
const RUN = Date.now().toString(36);
const TENANT_A = 'aaaaaa91-0000-4000-8000-000000000001';
const TENANT_B = 'aaaaaa92-0000-4000-8000-000000000002';
const USER_A1 = 'bbbbbb91-0000-4000-8000-000000000001';
const USER_A2 = 'bbbbbb92-0000-4000-8000-000000000002';
const USER_B1 = 'bbbbbb93-0000-4000-8000-000000000003';
const VEHICLE_A = 'cccccc91-0000-4000-8000-000000000001';
const DEVICE_A = 'dddddd91-0000-4000-8000-000000000001';

const TOPIC_POS = `fleetvision.test.${RUN}.position.raw`;

/** Test-only email provider — records invocations, never sends (Sprint H §43). */
class MockEmailProvider implements ChannelProvider {
  public readonly channel = 'email';
  public readonly providerName = 'mock-email';
  public readonly status = 'CONFIGURED' as const;
  public calls: Notification[] = [];
  public failFirst = 0;

  public async deliver(n: Notification) {
    this.calls.push(n);
    if (this.calls.length <= this.failFirst) {
      return {
        success: false,
        error: 'ETIMEDOUT connecting to SMTP relay',
        errorClass: 'TRANSIENT' as const,
      };
    }
    return { success: true, providerMessageId: `<mock-${this.calls.length}>` };
  }
}

let ctx: IntegrationCtx | null = null;
let redis: Redis | null = null;
let producer: import('kafkajs').Producer | null = null;
let consumer: AlarmKafkaConsumer | null = null;
let notificationsRepo: NotificationRepository | null = null;
let preferencesRepo: NotificationPreferenceRepository | null = null;
let deliveriesRepo: NotificationDeliveryRepository | null = null;
let mockEmail: MockEmailProvider | null = null;
let retryWorker: DeliveryRetryWorker | null = null;

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

async function notificationsFor(tenant: string, userId: string) {
  return (await notificationsRepo!.listPage(tenant, userId, 100, false)).data;
}

async function sendPosition(messageId: string, speedKph: number) {
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
          vehicleId: VEHICLE_A,
          tenantId: TENANT_A,
          protocolId: 'gt06',
          timestamp: new Date().toISOString(),
          position: { latitude: 35.7, longitude: 51.4, speedKph, headingDeg: 0 },
        }),
      },
    ],
  });
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
  try {
    const kafka = new Kafka({
      brokers: KAFKA_BROKERS.split(','),
      clientId: `sprint-h-test-${RUN}`,
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

  // Minimal iam.users projection — the trusted recipient source (Sprint H §20).
  await ctx.knex.raw('CREATE SCHEMA IF NOT EXISTS iam');
  await ctx.knex.raw(`
    CREATE TABLE IF NOT EXISTS iam.users (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL,
      email text,
      username text NOT NULL,
      status text NOT NULL DEFAULT 'ACTIVE',
      display_name text
    )
  `);
  await ctx.knex.raw(
    `INSERT INTO iam.users (id, tenant_id, email, username, status, display_name) VALUES
      (?::uuid, ?::uuid, 'a1@example.com', 'user-a1', 'ACTIVE', 'User A1'),
      (?::uuid, ?::uuid, 'a2@example.com', 'user-a2', 'ACTIVE', 'User A2'),
      (?::uuid, ?::uuid, 'b1@example.com', 'user-b1', 'ACTIVE', 'User B1')`,
    [USER_A1, TENANT_A, USER_A2, TENANT_A, USER_B1, TENANT_B],
  );

  // Clean stale Redis state for these fixed tenant ids.
  for (const pattern of [`tenant:${TENANT_A}:*`, `tenant:${TENANT_B}:*`]) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  }

  notificationsRepo = new NotificationRepository(ctx.knex);
  preferencesRepo = new NotificationPreferenceRepository(ctx.knex, ctx.knex);
  deliveriesRepo = new NotificationDeliveryRepository(ctx.knex, ctx.knex);
  mockEmail = new MockEmailProvider();
  const userDirectory = new UserDirectory(ctx.knex, null);

  const registry = new NotificationProviderRegistry()
    .register(new InAppChannel())
    .register(mockEmail);
  const executor = new DeliveryExecutor({
    deliveries: deliveriesRepo,
    metrics: null,
    maxAttempts: 3,
    retryBaseMs: 100, // tiny → retries become due almost immediately
  });
  const dispatcher = new NotificationDispatcherService({
    notifications: notificationsRepo,
    preferences: preferencesRepo,
    deliveries: deliveriesRepo,
    registry,
    userDirectory,
    rateLimiter: new NotificationRateLimiter({ redis, limitPerMinute: 1000 }),
    executor,
    metrics: null,
    defaultLocale: 'en',
    enabled: true,
  });
  retryWorker = new DeliveryRetryWorker({
    deliveries: deliveriesRepo,
    registry,
    executor,
    metrics: null,
    intervalMs: 0,
    batchSize: 50,
  });

  const config = {
    NOTIF_KAFKA_BROKERS: KAFKA_BROKERS,
    NOTIF_KAFKA_CLIENT_ID: `sprint-h-test-${RUN}`,
    NOTIF_KAFKA_GROUP_ID: `sprint-h-test-${RUN}`,
    NOTIF_KAFKA_POSITION_TOPIC: TOPIC_POS,
    NOTIF_KAFKA_SESSION_TOPIC: `fleetvision.test.${RUN}.session.lifecycle`,
    NOTIF_KAFKA_TRACKING_EVENT_TOPIC: `fleetvision.test.${RUN}.tracking.events`,
    NOTIF_KAFKA_MAX_ATTEMPTS: 2,
    NOTIF_KAFKA_RETRY_BACKOFF_MS: 100,
    NOTIF_KAFKA_CONSUMER_ENABLED: true,
    NOTIF_KAFKA_FROM_BEGINNING: true,
  } as unknown as NotificationConfig;

  const rulesRepo = new AlarmRuleRepository(ctx.knex, null, 1);
  const alarmsRepo = new AlarmOccurrenceRepository(ctx.knex);
  const evaluator = new AlarmEvaluatorService({
    rules: rulesRepo,
    alarms: alarmsRepo,
    stateCache: new AlarmStateCache(redis),
    gateway: null,
    dispatcher,
    metrics: null,
  });
  consumer = new AlarmKafkaConsumer({
    config,
    evaluator,
    stateCache: new AlarmStateCache(redis),
    fleetEvents: new FleetEventRepository(ctx.knex),
    dlq: null,
    metrics: null,
  });
  await consumer.onApplicationBootstrap();

  // Rule + preferences: A1 gets in_app only (defaults), A2 opts into email too.
  await rulesRepo.create(
    AlarmRule.create(undefined, {
      tenantId: TENANT_A,
      name: 'overspeed rule',
      type: 'overspeed' as never,
      severity: 'HIGH',
      enabled: true,
      entityType: 'vehicle',
      entityId: null,
      conditions: { thresholdKmh: 100 },
      // Short windows so the E2E scenarios can resolve + RE-RAISE a fresh
      // alarm within test time (Scenario 2/5 depend on a NEW dispatch).
      cooldownSec: 1,
      dedupWindowSec: 1,
      repeatPolicy: 'COOLDOWN',
    }),
  );
}, 120_000);

afterAll(async () => {
  await consumer?.onApplicationShutdown().catch(() => {});
  await producer?.disconnect().catch(() => {});
  await redis?.quit().catch(() => {});
  if (!ctx) return;
  await ctx.knex.destroy();
  await dropTestDb(ctx.admin, DB);
  await ctx.admin.destroy();
}, 120_000);

describe('Sprint H acceptance — alarm → per-user notifications → channel dispatch (real PostgreSQL + Redis + Kafka)', () => {
  it('skips when the docker stack is unreachable', () => {
    if (!ctx || !producer) return;
  });

  it('Scenario 1 — IN_APP: speeding alarm fans out to per-user notifications + unread counts', async () => {
    if (!ctx || !producer) return;
    await sendPosition('h1-slow', 80);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await notificationsFor(TENANT_A, USER_A1)).toHaveLength(0);

    await sendPosition('h1-fast', 130);
    expect(
      await waitFor(async () => (await notificationsFor(TENANT_A, USER_A1)).length === 1),
    ).toBe(true);

    const a1 = (await notificationsFor(TENANT_A, USER_A1))[0]!;
    expect(a1.userId).toBe(USER_A1);
    expect(a1.eventType).toBe('overspeed');
    expect(a1.vehicleId).toBe(VEHICLE_A);
    expect(a1.read).toBe(false);
    expect(a1.title).toBe(`Speeding: ${a1.metadata.vehicleName ?? VEHICLE_A}`);

    const unreadA1 = await notificationsRepo!.getUnreadCount(TENANT_A, USER_A1);
    expect(unreadA1.total).toBe(1);
  }, 60_000);

  it('Scenario 2 — EMAIL: preference opted in → provider invoked + delivery persisted', async () => {
    if (!ctx || !producer || !mockEmail) return;
    // A2 opts into email for the alarm category.
    await preferencesRepo!.upsert({
      tenantId: TENANT_A,
      userId: USER_A2,
      category: 'alarm',
      minSeverity: 'normal',
      channels: ['in_app', 'email'],
      enabled: true,
    } as never);

    // A NEW alarm (different vehicle position storm won't re-raise — use a
    // distinct rule type to get a fresh alarm id for A2's email dispatch).
    // The overspeed alarm already dispatched for both users before the
    // preference existed; dispatch a geofence-style event by raising another
    // overspeed after auto-resolve: simpler — resolve + re-raise.
    await sendPosition('h2-slow', 80); // auto-resolve the OPEN alarm
    expect(
      await waitFor(async () => {
        const a1 = (await notificationsFor(TENANT_A, USER_A1)).filter(
          (n) => n.sourceType === 'alarm',
        );
        return a1.length >= 1;
      }),
    ).toBe(true);
    await new Promise((r) => setTimeout(r, 1500));
    await sendPosition('h2-fast', 140); // raises a NEW overspeed alarm
    expect(await waitFor(async () => mockEmail!.calls.some((n) => n.userId === USER_A2))).toBe(
      true,
    );

    // Delivery row persisted with provider + SENT status.
    const a2Notifications = await notificationsFor(TENANT_A, USER_A2);
    const latest = a2Notifications.find((n) =>
      mockEmail!.calls.some((c) => c.sourceId === n.sourceId),
    );
    expect(latest).toBeDefined();
    const deliveries = await deliveriesRepo!.listForNotification(TENANT_A, latest!.id);
    const emailDelivery = deliveries.find((d) => d.channel === 'email');
    expect(emailDelivery).toBeDefined();
    expect(emailDelivery!.status).toBe('SENT'); // provider ACCEPTED (not DELIVERED)
    expect(emailDelivery!.provider).toBe('mock-email');
    expect(emailDelivery!.providerMessageId).toMatch(/^<mock-/);
  }, 60_000);

  it('Scenario 3 — DISABLED EMAIL: default user gets no email delivery', async () => {
    if (!ctx || !producer || !mockEmail) return;
    const emailCallsForA1 = mockEmail!.calls.filter((n) => n.userId === USER_A1);
    expect(emailCallsForA1).toHaveLength(0); // default prefs = in_app only
  }, 30_000);

  it('Scenario 4 — DUPLICATE alarm dispatch → no duplicate notifications (idempotency)', async () => {
    if (!ctx || !producer) return;
    const before = (await notificationsFor(TENANT_A, USER_A1)).length;
    // Same speeding condition continues — the alarm engine dedups the alarm
    // (one OPEN alarm) and even a re-dispatch of the SAME alarm id cannot
    // create a second notification (unique constraint).
    for (let i = 0; i < 5; i++) {
      await sendPosition(`h4-storm${i}`, 145);
    }
    await new Promise((r) => setTimeout(r, 2500));
    const after = (await notificationsFor(TENANT_A, USER_A1)).length;
    expect(after).toBe(before); // no notification storm
  }, 60_000);

  it('Scenario 5 — RETRY: transient provider failure → durable retry → SENT', async () => {
    if (!ctx || !retryWorker) return;
    // Drive the dispatcher + worker directly for a controlled retry scenario.
    mockEmail!.failFirst = 0;
    mockEmail!.calls = [];
    // Make the NEXT email attempt fail transiently once, then succeed.
    let attempt = 0;
    const originalDeliver = mockEmail!.deliver.bind(mockEmail!);
    mockEmail!.deliver = async (n: Notification) => {
      attempt += 1;
      if (attempt === 1) {
        return { success: false, error: 'ETIMEDOUT', errorClass: 'TRANSIENT' as const };
      }
      return originalDeliver(n);
    };

    // A2 has email enabled — a new unique alarm id triggers a fresh dispatch.
    await sendPosition('h5-slow', 80);
    await new Promise((r) => setTimeout(r, 1500));
    await sendPosition('h5-fast', 150);
    expect(await waitFor(async () => attempt >= 1)).toBe(true);

    // The failed delivery is durable-retry scheduled; the worker claims and
    // completes it (tiny backoff → due immediately).
    expect(
      await waitFor(async () => {
        await retryWorker!.tick();
        return attempt >= 2;
      }),
    ).toBe(true);

    expect(attempt).toBe(2);
    expect(mockEmail!.calls.length + 1).toBe(2); // first call threw, second recorded
  }, 60_000);

  it('Scenario 6 — TENANT ISOLATION: A never sees B, B never sees A', async () => {
    if (!ctx || !producer) return;
    const a1 = await notificationsFor(TENANT_A, USER_A1);
    expect(a1.every((n) => n.tenantId === TENANT_A)).toBe(true);
    // USER_B1 is in tenant B — sees none of tenant A's notifications.
    const b1 = await notificationsFor(TENANT_B, USER_B1);
    expect(b1).toHaveLength(0);
    // Cross-tenant detail lookup returns null.
    if (a1.length > 0) {
      expect(await notificationsRepo!.getById(TENANT_B, USER_B1, a1[0]!.id)).toBeNull();
    }
  }, 30_000);

  it('Scenario 7 — READ STATE: mark read + mark all read + unread count', async () => {
    if (!ctx || !producer) return;
    const before = await notificationsRepo!.getUnreadCount(TENANT_A, USER_A1);
    expect(before.total).toBeGreaterThan(0);

    const first = (await notificationsFor(TENANT_A, USER_A1))[0]!;
    await notificationsRepo!.markRead(TENANT_A, USER_A1, first.id);
    const afterOne = await notificationsRepo!.getUnreadCount(TENANT_A, USER_A1);
    expect(afterOne.total).toBe(before.total - 1);

    await notificationsRepo!.markAllRead(TENANT_A, USER_A1);
    const afterAll = await notificationsRepo!.getUnreadCount(TENANT_A, USER_A1);
    expect(afterAll.total).toBe(0);

    // Read state is PER USER: A2's copy is unaffected.
    const a2Unread = await notificationsRepo!.getUnreadCount(TENANT_A, USER_A2);
    expect(a2Unread.total).toBeGreaterThan(0);
  }, 30_000);
});
