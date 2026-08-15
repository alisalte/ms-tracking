import { describe, expect, it } from '@jest/globals';
import {
  MAX_DELIVERY_ATTEMPTS,
  NotificationDelivery,
  classifyDeliveryError,
  deliveryBackoffMs,
} from '../domain/notification-delivery.js';
import { NotificationPreference } from '../domain/notification-preference.js';
import { renderTemplate } from '../domain/notification-template.js';
import { notifSeverityRank, severityToPriority } from '../domain/notification-types.js';
import { Notification } from '../domain/notification.js';

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('Notification', () => {
  function makeNotification() {
    return Notification.create('n-1', {
      tenantId: TENANT,
      userId: USER,
      category: 'alarm',
      severity: 'high',
      eventType: 'overspeed',
      vehicleId: null,
      title: 'Overspeed',
      body: 'Vehicle exceeded limit',
      link: '/alarms?id=1',
      sourceType: 'alarm',
      sourceId: 'alarm-1',
    });
  }

  it('starts unread', () => {
    expect(makeNotification().read).toBe(false);
    expect(makeNotification().readAt).toBeNull();
  });

  it('markRead sets read=true + stamps readAt', () => {
    const n = makeNotification();
    n.markRead();
    expect(n.read).toBe(true);
    expect(n.readAt).not.toBeNull();
  });

  it('markRead is idempotent', () => {
    const n = makeNotification();
    n.markRead();
    const firstReadAt = n.readAt;
    n.markRead();
    expect(n.readAt).toBe(firstReadAt);
  });

  it('derives priority from severity when not set', () => {
    expect(makeNotification().priority).toBe('high'); // severity high → priority high
  });
});

describe('NotificationPreference', () => {
  function makePref(
    overrides: {
      minSeverity?: 'critical' | 'high' | 'normal' | 'low';
      channels?: string[];
      enabled?: boolean;
    } = {},
  ) {
    return new NotificationPreference({
      tenantId: TENANT,
      userId: USER,
      category: 'alarm',
      minSeverity: overrides.minSeverity ?? 'normal',
      channels: (overrides.channels ?? ['websocket', 'in_app']) as never,
      enabled: overrides.enabled ?? true,
    });
  }

  it('shouldDeliver returns true when severity >= minSeverity and channel enabled', () => {
    const pref = makePref({ minSeverity: 'normal', channels: ['websocket'] });
    expect(pref.shouldDeliver('high', 'websocket')).toBe(true);
    expect(pref.shouldDeliver('normal', 'websocket')).toBe(true);
  });

  it('shouldDeliver returns false when severity < minSeverity', () => {
    const pref = makePref({ minSeverity: 'high' });
    expect(pref.shouldDeliver('normal', 'websocket')).toBe(false);
    expect(pref.shouldDeliver('low', 'in_app')).toBe(false);
  });

  it('shouldDeliver returns false when channel not in enabled list', () => {
    const pref = makePref({ channels: ['websocket'] });
    expect(pref.shouldDeliver('critical', 'email')).toBe(false);
  });

  it('shouldDeliver returns false when preference disabled', () => {
    const pref = makePref({ enabled: false });
    expect(pref.shouldDeliver('critical', 'websocket')).toBe(false);
  });

  it('default() creates sensible defaults (in-app only — email/sms/push opt-in)', () => {
    const pref = NotificationPreference.default(TENANT, USER, 'alarm');
    expect(pref.enabled).toBe(true);
    expect(pref.minSeverity).toBe('normal');
    expect(pref.channels).toContain('websocket');
    expect(pref.channels).toContain('in_app');
    expect(pref.channels).not.toContain('email');
    expect(pref.channels).not.toContain('sms');
    expect(pref.channels).not.toContain('push');
  });
});

describe('NotificationDelivery', () => {
  it('starts as PENDING with 0 attempts', () => {
    const d = NotificationDelivery.create(TENANT, 'n-1', 'email', 'smtp');
    expect(d.status).toBe('PENDING');
    expect(d.attempts).toBe(0);
    expect(d.provider).toBe('smtp');
  });

  it('markSent sets status=SENT + stamps sentAt + records provider message id', () => {
    const d = NotificationDelivery.create(TENANT, 'n-1', 'email');
    d.markSent('<smtp-id-1>');
    expect(d.status).toBe('SENT');
    expect(d.sentAt).not.toBeNull();
    expect(d.error).toBeNull();
    expect(d.providerMessageId).toBe('<smtp-id-1>');
  });

  it('markDelivered only allowed from SENT (never from PENDING)', () => {
    const d = NotificationDelivery.create(TENANT, 'n-1', 'email');
    d.markDelivered();
    expect(d.status).toBe('PENDING');
    d.markSent();
    d.markDelivered();
    expect(d.status).toBe('DELIVERED');
  });

  it('transient failure schedules a durable retry with nextAttemptAt', () => {
    const d = NotificationDelivery.create(TENANT, 'n-1', 'email');
    const next = d.markFailed('connection refused', 'TRANSIENT');
    expect(d.status).toBe('PENDING');
    expect(d.attempts).toBe(1);
    expect(d.error).toBe('connection refused');
    expect(next).not.toBeNull();
    expect(d.nextAttemptAt).toEqual(next);
  });

  it('permanent failure fails fast with no retry', () => {
    const d = NotificationDelivery.create(TENANT, 'n-1', 'email');
    d.markFailed('invalid email address', 'PERMANENT');
    expect(d.status).toBe('FAILED');
    expect(d.nextAttemptAt).toBeNull();
    expect(d.canRetry()).toBe(false);
  });

  it('canRetry false when attempts >= max', () => {
    const d = NotificationDelivery.create(TENANT, 'n-1', 'email');
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i++) d.markFailed('timeout', 'TRANSIENT');
    expect(d.status).toBe('FAILED');
    expect(d.canRetry()).toBe(false);
    expect(d.nextAttemptAt).toBeNull();
  });

  it('isDue only when nextAttemptAt has passed', () => {
    const d = NotificationDelivery.create(TENANT, 'n-1', 'email');
    d.markFailed('timeout', 'TRANSIENT');
    expect(d.isDue(new Date(Date.now() + 60_000))).toBe(true);
    expect(d.isDue(new Date(Date.now() - 60_000))).toBe(false);
  });

  it('backoff doubles per attempt', () => {
    expect(deliveryBackoffMs(1, 2000)).toBe(2000);
    expect(deliveryBackoffMs(2, 2000)).toBe(4000);
    expect(deliveryBackoffMs(3, 2000)).toBe(8000);
  });

  it('classifies permanent vs transient errors', () => {
    expect(classifyDeliveryError(new Error('Invalid email address'))).toBe('PERMANENT');
    expect(classifyDeliveryError(new Error('provider rejected request'))).toBe('PERMANENT');
    expect(classifyDeliveryError(new Error('ETIMEDOUT'))).toBe('TRANSIENT');
    expect(classifyDeliveryError(new Error('ECONNRESET'))).toBe('TRANSIENT');
    expect(classifyDeliveryError(new Error('provider 503 unavailable'))).toBe('TRANSIENT');
  });
});

describe('notifSeverityRank / priority mapping', () => {
  it('orders severities correctly', () => {
    expect(notifSeverityRank.low).toBeLessThan(notifSeverityRank.normal);
    expect(notifSeverityRank.normal).toBeLessThan(notifSeverityRank.high);
    expect(notifSeverityRank.high).toBeLessThan(notifSeverityRank.critical);
  });

  it('maps severity to priority deterministically', () => {
    expect(severityToPriority('critical')).toBe('urgent');
    expect(severityToPriority('high')).toBe('high');
    expect(severityToPriority('normal')).toBe('normal');
    expect(severityToPriority('low')).toBe('low');
  });
});

describe('renderTemplate (safe interpolation)', () => {
  it('interpolates whitelisted values', () => {
    expect(
      renderTemplate('Vehicle {{vehicleName}} exceeded {{speedLimit}} km/h', {
        vehicleName: 'TRK-1',
        speedLimit: 90,
      }),
    ).toBe('Vehicle TRK-1 exceeded 90 km/h');
  });

  it('removes unknown placeholders (no leakage)', () => {
    expect(renderTemplate('Hello {{jwt}} {{password}}', {})).toBe('Hello  ');
  });

  it('is plain string replacement — never executes code', () => {
    expect(renderTemplate('{{vehicleName}}', { vehicleName: '{{constructor}}' })).toBe(
      '{{constructor}}',
    );
  });
});
