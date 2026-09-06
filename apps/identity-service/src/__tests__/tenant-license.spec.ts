import { describe, expect, it } from '@jest/globals';
import {
  buildLicense,
  canCreateResources,
  daysRemaining,
  hourInTimeZone,
  isWithinLoginHours,
  isWithinQuota,
  licenseStatus,
  planForTier,
  quotaMeter,
} from '../domain/tenant-license.js';

describe('tenant license domain', () => {
  const base = buildLicense('t1', 'STANDARD', {
    startsAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2026-12-31T00:00:00Z'),
    graceDays: 7,
    loginHoursStart: 7,
    loginHoursEnd: 22,
    timezone: 'UTC',
  });

  it('maps tenant tier to a plan', () => {
    expect(planForTier('STANDARD')).toBe('STANDARD');
    expect(planForTier('PROFESSIONAL')).toBe('PROFESSIONAL');
    expect(planForTier('ENTERPRISE')).toBe('ENTERPRISE');
  });

  it('is ACTIVE before expiry', () => {
    expect(licenseStatus(base, new Date('2026-06-01T00:00:00Z'))).toBe('ACTIVE');
    expect(canCreateResources('ACTIVE')).toBe(true);
  });

  it('enters GRACE for graceDays after expiry', () => {
    expect(licenseStatus(base, new Date('2027-01-03T00:00:00Z'))).toBe('GRACE');
    expect(canCreateResources('GRACE')).toBe(false);
  });

  it('is EXPIRED after grace', () => {
    expect(licenseStatus(base, new Date('2027-01-10T00:00:00Z'))).toBe('EXPIRED');
    expect(canCreateResources('EXPIRED')).toBe(false);
  });

  it('counts remaining days', () => {
    expect(daysRemaining(base, new Date('2026-12-21T00:00:00Z'))).toBe(10);
  });

  it('warns at 80% and exceeds at 100%', () => {
    expect(quotaMeter(79, 100).state).toBe('ok');
    expect(quotaMeter(80, 100).state).toBe('warn');
    expect(quotaMeter(100, 100).state).toBe('exceeded');
    expect(isWithinQuota(9, 10)).toBe(true);
    expect(isWithinQuota(10, 10)).toBe(false);
  });

  it('enforces a daytime login window in the tenant timezone', () => {
    expect(hourInTimeZone(new Date('2026-06-01T10:00:00Z'), 'UTC')).toBe(10);
    expect(isWithinLoginHours(base, new Date('2026-06-01T10:00:00Z'))).toBe(true);
    expect(isWithinLoginHours(base, new Date('2026-06-01T06:00:00Z'))).toBe(false);
    expect(isWithinLoginHours(base, new Date('2026-06-01T22:00:00Z'))).toBe(false);
  });

  it('allows overnight windows', () => {
    const night = { ...base, loginHoursStart: 22, loginHoursEnd: 6 };
    expect(isWithinLoginHours(night, new Date('2026-06-01T23:00:00Z'))).toBe(true);
    expect(isWithinLoginHours(night, new Date('2026-06-01T05:00:00Z'))).toBe(true);
    expect(isWithinLoginHours(night, new Date('2026-06-01T12:00:00Z'))).toBe(false);
  });
});
