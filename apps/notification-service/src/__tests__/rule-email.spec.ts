/**
 * Alarm-rule email recipients — validation, SMTP resolution (tenant → server
 * fallback), failure isolation + delivery recording, secret hygiene, and the
 * dispatcher wiring. No real SMTP is ever contacted (injected `send`).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { createRuleSchema, updateRuleSchema } from '../api/notification.dto.js';
import type { SmtpConfig } from '../application/channels/channels.js';
import { NotificationProviderRegistry } from '../application/channels/provider-registry.js';
import { DeliveryExecutor } from '../application/delivery-executor.js';
import {
  NotificationDispatcherService,
  formatTehranTime,
} from '../application/notification-dispatcher.service.js';
import { RuleEmailNotifier } from '../application/rule-email-notifier.js';
import { AlarmOccurrence } from '../domain/alarm-occurrence.js';
import { AlarmRule } from '../domain/alarm-rule.js';
import type { NotificationDelivery } from '../domain/notification-delivery.js';
import { normalizeRecipients } from '../domain/rule-recipients.js';
import { NotificationRateLimiter } from '../infrastructure/cache/notification-rate-limiter.js';
import { SecretBox } from '../infrastructure/crypto/secret-box.js';
import { TenantSmtpRepository } from '../infrastructure/persistence/tenant-smtp.repository.js';

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SERVER_SMTP: SmtpConfig = {
  host: 'smtp.server',
  port: 587,
  user: 'srv',
  pass: 'server-pass',
  from: 'srv@x.io',
};
const TENANT_SMTP: SmtpConfig = {
  host: 'smtp.tenant',
  port: 465,
  secure: true,
  user: 'ten',
  pass: 'tenant-pass',
  from: 'ten@x.io',
};

class FakeDeliveries {
  public rows: NotificationDelivery[] = [];
  public failCreate = false;
  public async create(d: NotificationDelivery) {
    if (this.failCreate) throw new Error('db down');
    this.rows.push(d);
  }
  public async updateStatus() {}
}

const msg = { tenantId: TENANT, alarmId: 'alarm-1', to: ['a@x.io'], subject: 's', text: 't' };

describe('normalizeRecipients', () => {
  it('trims, lowercases and dedupes', () => {
    expect(normalizeRecipients([' A@X.io ', 'a@x.io', '', 'b@x.io'])).toEqual(['a@x.io', 'b@x.io']);
  });
  it('rejects invalid addresses and lists over 10', () => {
    expect(normalizeRecipients(['nope'])).toBeNull();
    const eleven = Array.from({ length: 11 }, (_, i) => `u${i}@x.io`);
    expect(normalizeRecipients(eleven)).toBeNull();
    expect(normalizeRecipients(eleven.slice(0, 10))).toHaveLength(10);
  });
});

describe('rule DTO recipients', () => {
  const base = { name: 'r', type: 'ignition_on', severity: 'HIGH', conditions: {} };
  it('defaults to [] and normalizes on create', () => {
    expect(createRuleSchema.parse(base).recipients).toEqual([]);
    expect(createRuleSchema.parse({ ...base, recipients: [' A@X.io '] }).recipients).toEqual([
      'a@x.io',
    ]);
  });
  it('rejects invalid / too many on create and update', () => {
    expect(() => createRuleSchema.parse({ ...base, recipients: ['bad'] })).toThrow();
    const eleven = Array.from({ length: 11 }, (_, i) => `u${i}@x.io`);
    expect(() => updateRuleSchema.parse({ recipients: eleven })).toThrow();
    expect(updateRuleSchema.parse({ recipients: [] }).recipients).toEqual([]);
  });
  it('AlarmRule defaults recipients to []', () => {
    const rule = AlarmRule.create(undefined, {
      tenantId: TENANT,
      name: 'r',
      type: 'ignition_on',
      severity: 'HIGH',
      enabled: true,
      entityType: 'vehicle',
      entityId: null,
      conditions: {},
      cooldownSec: 0,
      dedupWindowSec: 0,
      repeatPolicy: 'COOLDOWN',
    });
    expect(rule.recipients).toEqual([]);
  });
});

describe('RuleEmailNotifier', () => {
  it('prefers the tenant SMTP over the server default', async () => {
    const used: SmtpConfig[] = [];
    const deliveries = new FakeDeliveries();
    const n = new RuleEmailNotifier({
      tenantSmtp: { get: async () => ({ kind: 'tenant', config: TENANT_SMTP }) },
      fallback: SERVER_SMTP,
      deliveries,
      send: async (smtp) => {
        used.push(smtp);
        return '<id>';
      },
    });
    await n.notify(msg);
    expect(used).toEqual([TENANT_SMTP]);
    expect(deliveries.rows[0]?.status).toBe('SENT');
    expect(deliveries.rows[0]?.providerMessageId).toBe('<id>');
  });

  it('falls back to the server SMTP when the tenant has none or settings are unreadable', async () => {
    for (const tenantSmtp of [
      { get: async () => ({ kind: 'none' as const }) },
      {
        get: async (): Promise<never> => {
          throw new Error('relation does not exist');
        },
      },
      null,
    ]) {
      const used: SmtpConfig[] = [];
      const n = new RuleEmailNotifier({
        tenantSmtp,
        fallback: SERVER_SMTP,
        deliveries: new FakeDeliveries(),
        send: async (smtp) => {
          used.push(smtp);
          return undefined;
        },
      });
      await n.notify(msg);
      expect(used).toEqual([SERVER_SMTP]);
    }
  });

  it('a tenant that disabled email gets no mail and no fallback', async () => {
    let sent = 0;
    const deliveries = new FakeDeliveries();
    const n = new RuleEmailNotifier({
      tenantSmtp: { get: async () => ({ kind: 'disabled' }) },
      fallback: SERVER_SMTP,
      deliveries,
      send: async () => {
        sent += 1;
        return undefined;
      },
    });
    await n.notify(msg);
    expect(sent).toBe(0);
    expect(deliveries.rows[0]?.status).toBe('FAILED');
    expect(deliveries.rows[0]?.error).toBe('SMTP not configured');
  });

  it('records a failed send without throwing and redacts the SMTP password', async () => {
    const deliveries = new FakeDeliveries();
    const n = new RuleEmailNotifier({
      tenantSmtp: { get: async () => ({ kind: 'tenant', config: TENANT_SMTP }) },
      fallback: null,
      deliveries,
      send: async () => {
        throw new Error(`auth failed for ten:${TENANT_SMTP.pass}`);
      },
    });
    await expect(n.notify(msg)).resolves.toBeUndefined();
    const row = deliveries.rows[0];
    expect(row?.status).toBe('FAILED'); // single attempt → terminal, no orphan retry
    expect(row?.nextAttemptAt).toBeNull();
    expect(row?.error).not.toContain(TENANT_SMTP.pass);
    expect(row?.error).toContain('***');
  });

  it('never throws even when recording the attempt fails', async () => {
    const deliveries = new FakeDeliveries();
    deliveries.failCreate = true;
    const n = new RuleEmailNotifier({
      tenantSmtp: null,
      fallback: SERVER_SMTP,
      deliveries,
      send: async () => undefined,
    });
    await expect(n.notify(msg)).resolves.toBeUndefined();
  });
});

describe('TenantSmtpRepository + SecretBox', () => {
  it('decrypts the tenant password and exposes it only inside the config', async () => {
    const key = randomBytes(32).toString('base64');
    const box = new SecretBox(key);
    const row = {
      enabled: true,
      host: 'smtp.t',
      port: 465,
      secure: true,
      username: 'u',
      password_enc: box.encrypt('p@ss'),
      from_address: 'f@x.io',
    };
    const fakeKnex = makeKnex(row);
    const repo = new TenantSmtpRepository(fakeKnex, box);
    const res = await repo.get(TENANT);
    expect(res).toEqual({
      kind: 'tenant',
      config: { host: 'smtp.t', port: 465, secure: true, user: 'u', pass: 'p@ss', from: 'f@x.io' },
    });
  });

  it('maps missing / disabled rows and hides decrypt details', async () => {
    const box = new SecretBox(randomBytes(32).toString('base64'));
    expect(await new TenantSmtpRepository(makeKnex(undefined), box).get(TENANT)).toEqual({
      kind: 'none',
    });
    const disabled = {
      enabled: false,
      host: 'h',
      port: 1,
      secure: false,
      username: null,
      password_enc: null,
      from_address: 'f@x.io',
    };
    expect(await new TenantSmtpRepository(makeKnex(disabled), box).get(TENANT)).toEqual({
      kind: 'disabled',
    });
    const wrongKey = new SecretBox(randomBytes(32).toString('base64'));
    const enc = box.encrypt('secret-value');
    const bad = { ...disabled, enabled: true, password_enc: enc };
    await expect(new TenantSmtpRepository(makeKnex(bad), wrongKey).get(TENANT)).rejects.toThrow(
      /could not be decrypted/,
    );
    await expect(new TenantSmtpRepository(makeKnex(bad), wrongKey).get(TENANT)).rejects.not.toThrow(
      enc,
    );
  });
});

/** Minimal knex stub: transaction(cb) → trx(table).where().first() → row. */
function makeKnex(row: unknown) {
  const trx = Object.assign(() => ({ where: () => ({ first: async () => row }) }), {
    raw: async () => undefined,
  });
  return { transaction: async (cb: (t: unknown) => unknown) => cb(trx) } as never;
}

describe('dispatcher → rule email', () => {
  function alarm() {
    return AlarmOccurrence.create('alarm-1', {
      tenantId: TENANT,
      ruleId: 'rule-1',
      type: 'overspeed',
      severity: 'HIGH',
      vehicleId: null,
      lat: 35.7,
      lng: 51.4,
      message: 'Vehicle exceeded 120 km/h',
      detail: { vehicleName: 'TRK-1', speed: 120, speedLimit: 90 },
      sourceEvents: [],
      raisedAt: new Date('2026-08-15T10:00:00Z'),
    } as never);
  }
  function make(ruleEmail: RuleEmailNotifier | undefined, users: unknown[] = []) {
    return new NotificationDispatcherService({
      notifications: { create: async () => true } as never,
      preferences: {} as never,
      deliveries: new FakeDeliveries() as never,
      registry: new NotificationProviderRegistry(),
      userDirectory: { listTenantUsers: async () => users } as never,
      rateLimiter: new NotificationRateLimiter({ redis: null, limitPerMinute: 100 }),
      executor: new DeliveryExecutor({
        deliveries: new FakeDeliveries() as never,
        metrics: null,
        maxAttempts: 3,
        retryBaseMs: 100,
      }),
      ruleEmail,
      metrics: null,
      defaultLocale: 'en',
      enabled: true,
    });
  }

  it('emails rule recipients even when the tenant has no users, with Tehran time', async () => {
    const sent: { to: readonly string[]; subject: string; text: string }[] = [];
    const notifier = new RuleEmailNotifier({
      tenantSmtp: null,
      fallback: SERVER_SMTP,
      deliveries: new FakeDeliveries(),
      send: async (_s, m) => {
        sent.push(m);
        return undefined;
      },
    });
    await make(notifier).dispatchAlarm(alarm(), { ruleRecipients: ['a@x.io', 'b@x.io'] });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual(['a@x.io', 'b@x.io']);
    expect(sent[0]?.subject).toBe('Speeding: TRK-1');
    // 10:00Z → 13:30 in Asia/Tehran (UTC+3:30)
    expect(sent[0]?.text).toContain('13:30:00');
    expect(sent[0]?.text).toContain('Asia/Tehran');
  });

  it('does nothing without recipients and survives a notifier that throws', async () => {
    let calls = 0;
    const throwing = {
      notify: async () => {
        calls += 1;
        throw new Error('boom');
      },
    } as unknown as RuleEmailNotifier;
    await make(throwing).dispatchAlarm(alarm());
    expect(calls).toBe(0);
    await expect(
      make(throwing).dispatchAlarm(alarm(), { ruleRecipients: ['a@x.io'] }),
    ).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });

  it('formatTehranTime handles missing dates', () => {
    expect(formatTehranTime(null)).toBe('');
  });
});
