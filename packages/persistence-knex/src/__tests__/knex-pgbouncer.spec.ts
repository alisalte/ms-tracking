import { describe, expect, it } from '@jest/globals';
import { routesThroughPgBouncer } from '../knex.factory.js';

/**
 * Sprint 2 bug 5f: createKnex did not set `prepare: false` under PgBouncer (the
 * code spread an empty object — a no-op). The fix passes a connection config
 * object with `prepare: false` when PgBouncer is detected. This test pins the
 * detection logic; the full createKnex (which instantiates a real knex client)
 * is exercised in integration.
 */
describe('PgBouncer prepare:false detection (bug 5f)', () => {
  it('detects PgBouncer via the pgbouncer=1 query param', () => {
    expect(routesThroughPgBouncer({ url: 'postgres://u:p@h:5432/db?pgbouncer=1' })).toBe(true);
  });

  it('detects PgBouncer via the explicit pgBouncer flag', () => {
    expect(routesThroughPgBouncer({ url: 'postgres://u:p@h:5432/db', pgBouncer: true })).toBe(true);
  });

  it('returns false for a plain connection', () => {
    expect(routesThroughPgBouncer({ url: 'postgres://u:p@h:5432/db' })).toBe(false);
  });
});
