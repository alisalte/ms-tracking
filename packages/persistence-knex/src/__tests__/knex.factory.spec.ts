import { describe, expect, it } from '@jest/globals';
import { routesThroughPgBouncer } from '../knex.factory.js';

describe('routesThroughPgBouncer', () => {
  it('returns false for a plain postgres URL', () => {
    expect(routesThroughPgBouncer({ url: 'postgres://u:p@host:5432/db' })).toBe(false);
  });

  it('returns true when the pgbouncer=1 query param is present', () => {
    expect(routesThroughPgBouncer({ url: 'postgres://u:p@host:5432/db?pgbouncer=1' })).toBe(true);
  });

  it('returns true when the explicit pgBouncer flag is set', () => {
    expect(routesThroughPgBouncer({ url: 'postgres://u:p@host:5432/db', pgBouncer: true })).toBe(
      true,
    );
  });

  it('detects pgbouncer with a leading ampersand (multi-param URL)', () => {
    expect(
      routesThroughPgBouncer({ url: 'postgres://u:p@host:5432/db?sslmode=require&pgbouncer=1' }),
    ).toBe(true);
  });
});
