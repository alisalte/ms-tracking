import { describe, expect, it } from '@jest/globals';
import { MAX_DELIVERY_ATTEMPTS, NotificationDelivery } from '../domain/notification-delivery.js';
import { NotificationPreference } from '../domain/notification-preference.js';
import { notifSeverityRank } from '../domain/notification-types.js';
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

  it('default() creates sensible defaults', () => {
    const pref = NotificationPreference.default(TENANT, USER, 'alarm');
    expect(pref.enabled).toBe(true);
    expect(pref.minSeverity).toBe('normal');
    expect(pref.channels).toContain('websocket');
    expect(pref.channels).toContain('in_app');
  });
});

describe('NotificationDelivery', () => {
  it('starts as PENDING with 0 attempts', () => {
    const d = NotificationDelivery.create(TENANT, 'n-1', 'email');
    expect(d.status).toBe('PENDING');
    expect(d.attempts).toBe(0);
  });

  it('markSent sets status=SENT + stamps sentAt', () => {
    const d = NotificationDelivery.create(TENANT, 'n-1', 'email');
    d.markSent();
    expect(d.status).toBe('SENT');
    expect(d.sentAt).not.toBeNull();
    expect(d.error).toBeNull();
  });

  it('markFailed sets status=FAILED + increments attempts', () => {
    const d = NotificationDelivery.create(TENANT, 'n-1', 'email');
    d.markFailed('connection refused');
    expect(d.status).toBe('FAILED');
    expect(d.attempts).toBe(1);
    expect(d.error).toBe('connection refused');
  });

  it('canRetry returns true when FAILED and attempts < max', () => {
    const d = NotificationDelivery.create(TENANT, 'n-1', 'email');
    d.markFailed('err');
    expect(d.canRetry()).toBe(true);
  });

  it('canRetry returns false when attempts >= max', () => {
    const d = NotificationDelivery.create(TENANT, 'n-1', 'email');
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i++) d.markFailed('err');
    expect(d.canRetry()).toBe(false);
  });

  it('resetForRetry sets status back to PENDING', () => {
    const d = NotificationDelivery.create(TENANT, 'n-1', 'email');
    d.markFailed('err');
    d.resetForRetry();
    expect(d.status).toBe('PENDING');
  });
});

describe('notifSeverityRank', () => {
  it('orders severities correctly', () => {
    expect(notifSeverityRank.low).toBeLessThan(notifSeverityRank.normal);
    expect(notifSeverityRank.normal).toBeLessThan(notifSeverityRank.high);
    expect(notifSeverityRank.high).toBeLessThan(notifSeverityRank.critical);
  });
});
