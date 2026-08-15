/**
 * Sprint H unit tests — Notification Center.
 *
 * Covers: recipient resolution fan-out, preference filtering, disabled
 * channels/providers, template rendering (en/fa), idempotency dedup,
 * rate limiting, transient vs permanent failures, the durable retry
 * worker, and the provider registry. Providers are in-test fakes — no
 * external email/SMS/push API is ever contacted (Sprint H §43/§44).
 */
import { describe, expect, it } from '@jest/globals';
import type { ChannelProvider } from '../application/channels/channel-provider.js';
import {
  InAppChannel,
  PushChannel,
  SmsChannel,
  SmtpEmailProvider,
} from '../application/channels/channels.js';
import { NotificationProviderRegistry } from '../application/channels/provider-registry.js';
import { DeliveryExecutor } from '../application/delivery-executor.js';
import { DeliveryRetryWorker } from '../application/delivery-retry-worker.js';
import { NotificationDispatcherService } from '../application/notification-dispatcher.service.js';
import { renderNotificationContent } from '../application/templates/notification-templates.js';
import { AlarmOccurrence } from '../domain/alarm-occurrence.js';
import { NotificationDelivery } from '../domain/notification-delivery.js';
import { mapAlarmSeverity } from '../domain/notification-types.js';
import type { NotificationSeverity } from '../domain/notification-types.js';
import { Notification } from '../domain/notification.js';
import { NotificationRateLimiter } from '../infrastructure/cache/notification-rate-limiter.js';

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const USER_A = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_B = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const VEHICLE = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

// ── In-memory fakes ────────────────────────────────────────────────────────

class FakeNotificationRepo {
  public rows = new Map<string, Notification>();
  public failInserts = false;

  public async create(n: Notification): Promise<boolean> {
    if (this.failInserts) return false;
    const dup = [...this.rows.values()].find(
      (r) =>
        r.tenantId === n.tenantId &&
        r.userId === n.userId &&
        r.sourceType === n.sourceType &&
        r.sourceId === n.sourceId,
    );
    if (dup) return false;
    this.rows.set(n.id, n);
    return true;
  }
}

class FakePreferenceRepo {
  public prefs = new Map<string, { channels: string[]; enabled: boolean; minSeverity: string }>();

  public async getOrDefault(tenantId: string, userId: string, category: string) {
    const key = `${tenantId}:${userId}:${category}`;
    const p = this.prefs.get(key);
    return {
      tenantId,
      userId,
      category,
      minSeverity: (p?.minSeverity ?? 'normal') as NotificationSeverity,
      channels: (p?.channels ?? ['websocket', 'in_app']) as never,
      enabled: p?.enabled ?? true,
      shouldDeliver(_severity: NotificationSeverity, channel: string) {
        return (p?.enabled ?? true) && (p?.channels ?? ['websocket', 'in_app']).includes(channel);
      },
    } as never;
  }
}

class FakeDeliveryRepo {
  public rows = new Map<string, NotificationDelivery>();

  public async create(d: NotificationDelivery) {
    this.rows.set(d.id, d);
  }
  public async updateStatus(d: NotificationDelivery) {
    this.rows.set(d.id, d);
  }
}

class FakeUserDirectory {
  public users: { userId: string; tenantId: string; email: string | null }[] = [
    { userId: USER_A, tenantId: TENANT, email: 'a@example.com' },
    { userId: USER_B, tenantId: TENANT, email: 'b@example.com' },
  ];

  public async listTenantUsers(tenantId: string) {
    return this.users.filter((u) => u.tenantId === tenantId);
  }
  public async getUser(tenantId: string, userId: string) {
    return this.users.find((u) => u.tenantId === tenantId && u.userId === userId) ?? null;
  }
}

/** Test-only email provider — records invocations, never sends (Sprint H §43). */
class MockEmailProvider implements ChannelProvider {
  public readonly channel = 'email';
  public readonly providerName = 'mock';
  public readonly status = 'CONFIGURED' as const;
  public calls: Notification[] = [];
  public failFirstAttempts = 0; // transient failures before succeeding

  public async deliver(n: Notification) {
    this.calls.push(n);
    if (this.calls.length <= this.failFirstAttempts) {
      return { success: false, error: 'ETIMEDOUT', errorClass: 'TRANSIENT' as const };
    }
    return { success: true, providerMessageId: '<mock-1>' };
  }
}

class AlwaysFailTransientProvider implements ChannelProvider {
  public readonly channel = 'websocket';
  public readonly providerName = 'mock-ws';
  public readonly status = 'CONFIGURED' as const;
  public attempts = 0;

  public async deliver() {
    this.attempts += 1;
    return { success: false, error: 'connection reset by peer', errorClass: 'TRANSIENT' as const };
  }
}

function makeAlarm(tenantId = TENANT, overrides: Partial<Record<string, unknown>> = {}) {
  return AlarmOccurrence.create('alarm-1', {
    tenantId,
    ruleId: 'rule-1',
    type: (overrides.type as string) ?? 'overspeed',
    severity: 'HIGH',
    vehicleId: VEHICLE,
    lat: 35.7,
    lng: 51.4,
    message: 'Vehicle exceeded 120 km/h in 90 zone',
    detail: {
      vehicleName: 'TRK-1',
      speed: 120,
      speedLimit: 90,
      // Non-whitelisted keys must never reach templates:
      password: 'hunter2',
      jwt: 'secret-token',
    },
    sourceEvents: [],
    raisedAt: new Date('2026-08-15T10:00:00Z'),
    ...overrides,
  } as never);
}

function makeDispatcher(fakes: {
  notifications?: FakeNotificationRepo;
  preferences?: FakePreferenceRepo;
  deliveries?: FakeDeliveryRepo;
  userDirectory?: FakeUserDirectory;
  registry?: NotificationProviderRegistry;
  rateLimitPerMin?: number;
}) {
  const notifications = fakes.notifications ?? new FakeNotificationRepo();
  const preferences = fakes.preferences ?? new FakePreferenceRepo();
  const deliveries = fakes.deliveries ?? new FakeDeliveryRepo();
  const userDirectory = fakes.userDirectory ?? new FakeUserDirectory();
  const registry =
    fakes.registry ??
    new NotificationProviderRegistry()
      .register(new InAppChannel())
      .register(new MockEmailProvider());
  const rateLimiter = new NotificationRateLimiter({
    redis: null,
    limitPerMinute: fakes.rateLimitPerMin ?? 1000,
  });
  const executor = new DeliveryExecutor({
    deliveries: deliveries as never,
    metrics: null,
    maxAttempts: 3,
    retryBaseMs: 100,
  });
  const dispatcher = new NotificationDispatcherService({
    notifications: notifications as never,
    preferences: preferences as never,
    deliveries: deliveries as never,
    registry,
    userDirectory: userDirectory as never,
    rateLimiter,
    executor,
    metrics: null,
    defaultLocale: 'en',
    enabled: true,
  });
  return { dispatcher, notifications, preferences, deliveries, registry, executor, userDirectory };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Sprint H — dispatcher recipient fan-out', () => {
  it('creates ONE per-user notification for every active tenant user', async () => {
    const { dispatcher, notifications, deliveries } = makeDispatcher({});
    await dispatcher.dispatchAlarm(makeAlarm());

    const rows = [...notifications.rows.values()];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.userId).sort()).toEqual([USER_A, USER_B].sort());
    // Every record carries the alarm context.
    for (const row of rows) {
      expect(row.eventType).toBe('overspeed');
      expect(row.vehicleId).toBe(VEHICLE);
      expect(row.sourceType).toBe('alarm');
      expect(row.sourceId).toBe('alarm-1');
      expect(row.priority).toBe('high'); // severity HIGH → priority high
    }
    // Default prefs = in_app + websocket; the test registry registers in_app
    // + email(mock), so only in_app dispatches → 2 deliveries.
    expect(deliveries.rows.size).toBe(2);
  });

  it('does NOT create notifications for other tenants', async () => {
    const { dispatcher, notifications } = makeDispatcher({});
    await dispatcher.dispatchAlarm(makeAlarm(TENANT_B));
    expect([...notifications.rows.values()].every((r) => r.tenantId === TENANT_B)).toBe(true);
  });

  it('renders localized template content from whitelisted detail keys', async () => {
    const { dispatcher, notifications } = makeDispatcher({});
    await dispatcher.dispatchAlarm(makeAlarm());

    const row = [...notifications.rows.values()][0];
    expect(row?.title).toBe('Speeding: TRK-1');
    expect(row?.body).toContain('TRK-1');
    expect(row?.body).toContain('120');
    expect(row?.body).toContain('90');
    // Secrets from detail never leak into the rendered content.
    expect(`${row?.title}${row?.body}`).not.toContain('hunter2');
    expect(`${row?.title}${row?.body}`).not.toContain('secret-token');
    // But the metadata record also only holds whitelisted keys.
    expect(row?.metadata).not.toHaveProperty('password');
    expect(row?.metadata).not.toHaveProperty('jwt');
  });

  it('duplicate alarm source does not duplicate notifications (idempotency)', async () => {
    const { dispatcher, notifications } = makeDispatcher({});
    await dispatcher.dispatchAlarm(makeAlarm());
    await dispatcher.dispatchAlarm(makeAlarm()); // Kafka redelivery, same alarm id
    expect(notifications.rows.size).toBe(2); // still one per user, not four
  });

  it('skips users whose preference disables all channels', async () => {
    const preferences = new FakePreferenceRepo();
    preferences.prefs.set(`${TENANT}:${USER_A}:alarm`, {
      channels: [],
      enabled: false,
      minSeverity: 'normal',
    });
    const { dispatcher, notifications } = makeDispatcher({ preferences });
    await dispatcher.dispatchAlarm(makeAlarm());
    const rows = [...notifications.rows.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(USER_B);
  });

  it('never dispatches through a DISABLED provider (email unconfigured)', async () => {
    const registry = new NotificationProviderRegistry()
      .register(new InAppChannel())
      .register(new SmtpEmailProvider(null, async () => null));
    const preferences = new FakePreferenceRepo();
    preferences.prefs.set(`${TENANT}:${USER_A}:alarm`, {
      channels: ['in_app', 'email'],
      enabled: true,
      minSeverity: 'normal',
    });
    const { dispatcher, deliveries } = makeDispatcher({ registry, preferences });
    await dispatcher.dispatchAlarm(makeAlarm());
    // Only in_app deliveries exist — the unconfigured email provider is skipped.
    const channels = [...deliveries.rows.values()].map((d) => d.channel);
    expect(channels).not.toContain('email');
    expect(channels).toContain('in_app');
  });

  it('suppresses dispatch when the per-user/channel rate limit is exceeded', async () => {
    let calls = 0;
    const rateLimiter = new NotificationRateLimiter({
      redis: {
        incr: async () => ++calls,
        expire: async () => 1,
      },
      limitPerMinute: 1,
    });
    const { dispatcher, deliveries } = (() => {
      const base = makeDispatcher({ rateLimitPerMin: 1 });
      // Rebuild with a shared rate limiter across both users.
      const dispatcher2 = new NotificationDispatcherService({
        notifications: base.notifications as never,
        preferences: base.preferences as never,
        deliveries: base.deliveries as never,
        registry: base.registry,
        userDirectory: base.userDirectory as never,
        rateLimiter,
        executor: base.executor,
        metrics: null,
        defaultLocale: 'en',
        enabled: true,
      });
      return { dispatcher: dispatcher2, deliveries: base.deliveries };
    })();
    await dispatcher.dispatchAlarm(makeAlarm());
    // First INCR=1 (allowed), second INCR=2 (rate limited) → only 1 delivery.
    expect(deliveries.rows.size).toBe(1);
  });

  it('does nothing when NOTIFICATION_ENABLED=false', async () => {
    const base = makeDispatcher({});
    const disabled = new NotificationDispatcherService({
      notifications: base.notifications as never,
      preferences: base.preferences as never,
      deliveries: base.deliveries as never,
      registry: base.registry,
      userDirectory: base.userDirectory as never,
      rateLimiter: new NotificationRateLimiter({ redis: null, limitPerMinute: 1000 }),
      executor: base.executor,
      metrics: null,
      defaultLocale: 'en',
      enabled: false,
    });
    await disabled.dispatchAlarm(makeAlarm());
    expect(base.notifications.rows.size).toBe(0);
  });
});

describe('Sprint H — delivery executor + durable retry', () => {
  it('transient failure schedules a durable retry (next_attempt_at persisted)', async () => {
    const deliveries = new FakeDeliveryRepo();
    const provider = new AlwaysFailTransientProvider();
    const executor = new DeliveryExecutor({
      deliveries: deliveries as never,
      metrics: null,
      maxAttempts: 3,
      retryBaseMs: 100,
    });
    const notification = Notification.create(undefined, {
      tenantId: TENANT,
      userId: USER_A,
      category: 'alarm',
      severity: 'high',
      eventType: 'overspeed',
      vehicleId: null,
      title: 't',
      body: 'b',
      link: null,
      sourceType: 'alarm',
      sourceId: 'alarm-x',
    });
    const delivery = NotificationDelivery.create(TENANT, notification.id, 'websocket');
    await deliveries.create(delivery);
    await executor.execute(provider, notification, delivery);

    expect(delivery.status).toBe('PENDING');
    expect(delivery.nextAttemptAt).not.toBeNull();
    expect(provider.attempts).toBe(1);
  });

  it('retry worker claims due deliveries and re-dispatches them', async () => {
    const deliveries = new FakeDeliveryRepo();
    const provider = new MockEmailProvider();
    provider.failFirstAttempts = 1; // first attempt fails transiently
    const registry = new NotificationProviderRegistry().register(provider);
    const executor = new DeliveryExecutor({
      deliveries: deliveries as never,
      metrics: null,
      maxAttempts: 3,
      retryBaseMs: 1, // tiny backoff → due immediately
    });
    const notification = Notification.create(undefined, {
      tenantId: TENANT,
      userId: USER_A,
      category: 'alarm',
      severity: 'high',
      eventType: 'overspeed',
      vehicleId: null,
      title: 't',
      body: 'b',
      link: null,
      sourceType: 'alarm',
      sourceId: 'alarm-y',
    });
    const delivery = NotificationDelivery.create(TENANT, notification.id, 'email');
    await deliveries.create(delivery);
    await executor.execute(provider, notification, delivery);
    expect(delivery.status).toBe('PENDING'); // failed once, retry scheduled

    // Simulate the worker sweep with a claim fake that returns the due row.
    const claimed = [
      {
        delivery,
        notification: Notification.rehydrate(notification.id, {
          tenantId: TENANT,
          userId: USER_A,
          category: 'alarm',
          severity: 'high',
          eventType: 'overspeed',
          vehicleId: null,
          priority: 'high',
          title: 't',
          body: 'b',
          link: null,
          metadata: {},
          read: false,
          readAt: null,
          sourceType: 'alarm',
          sourceId: 'alarm-y',
          createdAt: new Date(),
        }),
      },
    ];
    const deliveryRepoWithClaim = {
      ...deliveries,
      claimDueDeliveries: async () => claimed,
    } as unknown as FakeDeliveryRepo;
    const worker = new DeliveryRetryWorker({
      deliveries: deliveryRepoWithClaim as never,
      registry,
      executor,
      metrics: null,
      intervalMs: 0,
      batchSize: 10,
    });
    const handled = await worker.tick();
    expect(handled).toBe(1);
    expect(provider.calls).toHaveLength(2); // first attempt + retry
    expect(delivery.status).toBe('SENT'); // retry succeeded
    expect(delivery.providerMessageId).toBe('<mock-1>');
  });
});

describe('Sprint H — provider registry', () => {
  it('exposes CONFIGURED vs DISABLED statuses without secrets', () => {
    const registry = new NotificationProviderRegistry()
      .register(new InAppChannel())
      .register(new SmtpEmailProvider(null, async () => null))
      .register(new SmsChannel(false))
      .register(new PushChannel(false));
    const health = registry.healthSnapshot();
    const byChannel = Object.fromEntries(health.map((h) => [h.channel, h.status]));
    expect(byChannel.in_app).toBe('CONFIGURED');
    expect(byChannel.email).toBe('DISABLED'); // SMTP unset
    expect(byChannel.sms).toBe('DISABLED');
    expect(byChannel.push).toBe('DISABLED');
    expect(JSON.stringify(health)).not.toContain('pass');
  });

  it('configured() returns only dispatchable providers', () => {
    const registry = new NotificationProviderRegistry()
      .register(new InAppChannel())
      .register(new SmsChannel(false));
    expect(registry.configured().map((p) => p.channel)).toEqual(['in_app']);
    expect(registry.isDispatchable('sms')).toBe(false);
    expect(registry.isDispatchable('in_app')).toBe(true);
  });

  it('SMS/PUSH providers honestly refuse to deliver when not configured', async () => {
    const sms = new SmsChannel(false);
    const push = new PushChannel(false);
    await expect(sms.deliver()).resolves.toMatchObject({ success: false, errorClass: 'PERMANENT' });
    await expect(push.deliver()).resolves.toMatchObject({
      success: false,
      errorClass: 'PERMANENT',
    });
  });
});

describe('Sprint H — templates + i18n', () => {
  it('renders en and fa for the same event', () => {
    const en = renderNotificationContent('geofence_enter', 'en', {
      vehicleName: 'TRK-1',
      geofenceName: 'Depot',
    });
    const fa = renderNotificationContent('geofence_enter', 'fa', {
      vehicleName: 'TRK-1',
      geofenceName: 'Depot',
    });
    expect(en.title).toBe('Geofence entry: TRK-1');
    expect(en.body).toContain('Depot');
    expect(fa.title).toContain('TRK-1');
    expect(fa.title).toContain('حصار جغرافیایی');
  });

  it('falls back to the alarm message for unknown event types', () => {
    const out = renderNotificationContent(
      'mystery_event',
      'en',
      {},
      { title: 'Alarm: mystery event', body: 'raw message' },
    );
    expect(out).toEqual({ title: 'Alarm: mystery event', body: 'raw message' });
  });

  it('every alarm rule type has a template', () => {
    const ruleTypes = [
      'overspeed',
      'ignition_on',
      'ignition_off',
      'prolonged_idle',
      'parking',
      'device_offline',
      'low_battery',
      'geofence_enter',
      'geofence_exit',
      'geofence_dwell',
      'trip_started',
      'trip_ended',
      'excessive_trip_duration',
      'excessive_stop_duration',
    ];
    for (const type of ruleTypes) {
      expect(renderNotificationContent(type, 'en', {}).title.length).toBeGreaterThan(0);
      expect(renderNotificationContent(type, 'fa', {}).title.length).toBeGreaterThan(0);
    }
  });
});

describe('Sprint H — severity/priority mapping', () => {
  it('maps Sprint G severities onto notification priorities deterministically', () => {
    expect(mapAlarmSeverity('CRITICAL')).toBe('critical');
    expect(mapAlarmSeverity('HIGH')).toBe('high');
    expect(mapAlarmSeverity('MEDIUM')).toBe('normal');
    expect(mapAlarmSeverity('LOW')).toBe('low');
  });
});

describe('Sprint H — rate limiter', () => {
  it('blocks beyond the per-minute window and fails open on Redis outage', async () => {
    let count = 0;
    const limiter = new NotificationRateLimiter({
      redis: { incr: async () => ++count, expire: async () => 1 },
      limitPerMinute: 2,
    });
    expect(await limiter.allow(TENANT, USER_A, 'in_app')).toBe(true);
    expect(await limiter.allow(TENANT, USER_A, 'in_app')).toBe(true);
    expect(await limiter.allow(TENANT, USER_A, 'in_app')).toBe(false);

    const broken = new NotificationRateLimiter({
      redis: {
        incr: () => Promise.reject(new Error('redis down')),
        expire: () => Promise.reject(new Error('redis down')),
      },
      limitPerMinute: 1,
    });
    expect(await broken.allow(TENANT, USER_A, 'in_app')).toBe(true);
  });

  it('disabled when limit is 0', async () => {
    const limiter = new NotificationRateLimiter({ redis: null, limitPerMinute: 0 });
    for (let i = 0; i < 100; i++) {
      expect(await limiter.allow(TENANT, USER_A, 'email')).toBe(true);
    }
  });
});
