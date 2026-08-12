import { assertUuid, withTenantContext } from '@fleetvision/persistence-knex';
import { describe, expect, it } from '@jest/globals';

/**
 * tenant-context (Sprint 1 RLS): withTenantContext must reject a non-UUID
 * tenant_id BEFORE interpolating it into SET LOCAL (no SQL-injection surface),
 * and accept a canonical UUID.
 */
describe('withTenantContext UUID guard', () => {
  it('accepts a canonical UUID', () => {
    expect(() => assertUuid('11111111-1111-1111-1111-111111111111')).not.toThrow();
  });
  it('rejects a non-UUID (injection attempt)', () => {
    expect(() => assertUuid("'; DROP TABLE iam.users; --")).toThrow();
  });
  it('rejects an empty string', () => {
    expect(() => assertUuid('')).toThrow();
  });
  it('rejects a partial UUID', () => {
    expect(() => assertUuid('11111111-1111-1111')).toThrow();
  });
  it('withTenantContext rejects a non-UUID tenant without opening a transaction', async () => {
    const fakeKnex = {
      transaction: async () => {
        throw new Error('transaction should not be opened for a non-UUID tenant');
      },
    };
    await expect(
      withTenantContext(fakeKnex as never, 'not-a-uuid', async () => 1),
    ).rejects.toThrow();
  });
});
