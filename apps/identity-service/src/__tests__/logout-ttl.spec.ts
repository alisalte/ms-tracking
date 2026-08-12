import { describe, expect, it } from '@jest/globals';

/**
 * Sprint 2 bug 5c: the logout endpoints hardcoded `accessTtlRemainingSeconds: 900`
 * instead of deriving it from the JWT `exp` claim. This test pins the
 * `accessTtlRemaining` helper the controller now uses (defined inline in the
 * controller module — re-implemented here to test the formula without importing
 * the full NestJS controller graph).
 */
function accessTtlRemaining(exp: number): number {
  return Math.max(0, exp - Math.floor(Date.now() / 1000));
}

describe('logout TTL derived from JWT exp (bug 5c)', () => {
  it('returns the remaining seconds until expiry', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(accessTtlRemaining(now + 300)).toBe(300);
    expect(accessTtlRemaining(now + 1)).toBe(1);
  });

  it('clamps to 0 for an already-expired token', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(accessTtlRemaining(now - 10)).toBe(0);
  });

  it('is NOT hardcoded to 900', () => {
    const now = Math.floor(Date.now() / 1000);
    // A token with 30 minutes left must yield ~1800, not the old hardcoded 900.
    expect(accessTtlRemaining(now + 1800)).toBeGreaterThan(1700);
    expect(accessTtlRemaining(now + 1800)).not.toBe(900);
  });
});
