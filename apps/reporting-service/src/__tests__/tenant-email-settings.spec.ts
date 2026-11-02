import { randomBytes } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import {
  TenantEmailSettingsError,
  TenantEmailSettingsService,
} from '../application/tenant-email-settings.service.js';
import { SecretBox } from '../infrastructure/crypto/secret-box.js';
import { TenantSmtpReportMailer } from '../infrastructure/mail/report-mailer.js';

const key = randomBytes(32).toString('base64');

describe('SecretBox', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const box = new SecretBox(key);
    const a = box.encrypt('s3cret');
    expect(a).not.toContain('s3cret');
    expect(box.encrypt('s3cret')).not.toBe(a);
    expect(box.decrypt(a)).toBe('s3cret');
  });

  it('rejects tampering, wrong key length, and use without a key', () => {
    const box = new SecretBox(key);
    const enc = box.encrypt('x').split(':');
    enc[3] = Buffer.from('tampered').toString('base64');
    expect(() => box.decrypt(enc.join(':'))).toThrow();
    expect(() => new SecretBox('c2hvcnQ=')).toThrow();
    const none = new SecretBox(undefined);
    expect(none.available).toBe(false);
    expect(() => none.encrypt('x')).toThrow();
  });
});

function fakeRepo() {
  let row: Record<string, unknown> | null = null;
  return {
    get row() {
      return row;
    },
    seed(r: Record<string, unknown> | null) {
      row = r;
    },
    repo: {
      get: async () => row,
      upsert: async (_t: string, i: Record<string, unknown>) => {
        row = {
          ...i,
          passwordEnc: i.passwordEnc === undefined ? (row?.passwordEnc ?? null) : i.passwordEnc,
          updatedAt: new Date(),
        };
        return row;
      },
      remove: async () => {
        const had = row !== null;
        row = null;
        return had;
      },
    },
  };
}

const input = {
  enabled: true,
  host: 'smtp.acme.test',
  port: 587,
  secure: false,
  fromAddress: 'reports@acme.test',
};

describe('TenantEmailSettingsService', () => {
  const mailer = { isEnabled: async () => true, send: async () => undefined };

  it('stores the password encrypted and never returns it', async () => {
    const f = fakeRepo();
    const svc = new TenantEmailSettingsService(f.repo as never, new SecretBox(key), mailer);
    const out = await svc.save('t1', 'u1', { ...input, password: 'pw' });
    expect(out.hasPassword).toBe(true);
    expect(JSON.stringify(out)).not.toContain('pw"');
    expect(f.row?.passwordEnc).not.toBe('pw');
  });

  it('keeps the stored password when omitted and clears it when empty', async () => {
    const f = fakeRepo();
    const svc = new TenantEmailSettingsService(f.repo as never, new SecretBox(key), mailer);
    await svc.save('t1', null, { ...input, password: 'pw' });
    expect((await svc.save('t1', null, input)).hasPassword).toBe(true);
    expect((await svc.save('t1', null, { ...input, password: '' })).hasPassword).toBe(false);
  });

  it('refuses to store a password without REPORT_SECRETS_KEY', async () => {
    const svc = new TenantEmailSettingsService(
      fakeRepo().repo as never,
      new SecretBox(undefined),
      mailer,
    );
    await expect(svc.save('t1', null, { ...input, password: 'pw' })).rejects.toBeInstanceOf(
      TenantEmailSettingsError,
    );
  });

  it('404s when removing settings that do not exist', async () => {
    const svc = new TenantEmailSettingsService(
      fakeRepo().repo as never,
      new SecretBox(key),
      mailer,
    );
    await expect(svc.remove('t1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('TenantSmtpReportMailer.resolve', () => {
  const fallback = {
    host: 'global',
    port: 25,
    secure: false,
    user: '',
    pass: '',
    from: 'g@x.test',
  };

  it('prefers tenant settings, decrypting the password', async () => {
    const box = new SecretBox(key);
    const f = fakeRepo();
    f.seed({ ...input, username: 'u', passwordEnc: box.encrypt('pw'), updatedAt: new Date() });
    const m = new TenantSmtpReportMailer(f.repo as never, box, fallback);
    expect(await m.resolve('t1')).toMatchObject({ host: 'smtp.acme.test', user: 'u', pass: 'pw' });
  });

  it('falls back to the server default when the tenant has no row', async () => {
    const m = new TenantSmtpReportMailer(fakeRepo().repo as never, new SecretBox(key), fallback);
    expect((await m.resolve('t1'))?.host).toBe('global');
  });

  it('a disabled tenant row means no email (no fallback)', async () => {
    const f = fakeRepo();
    f.seed({ ...input, enabled: false, username: null, passwordEnc: null, updatedAt: new Date() });
    const m = new TenantSmtpReportMailer(f.repo as never, new SecretBox(key), fallback);
    expect(await m.isEnabled('t1')).toBe(false);
  });
});
