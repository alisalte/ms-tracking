import type { Redis } from '@fleetvision/cache-redis';
import { describe, expect, it } from '@jest/globals';
import { RevocationStore } from '../revocation-store.js';

/** In-memory Redis covering the commands the revocation store uses. */
function memoryRedis(): Redis {
  const values = new Map<string, { value: string; expiresAt: number }>();
  const live = (key: string): string | null => {
    const row = values.get(key);
    if (!row) return null;
    if (row.expiresAt <= Date.now()) {
      values.delete(key);
      return null;
    }
    return row.value;
  };
  return {
    set: async (key: string, value: string, _mode: string, ttlSeconds: number) => {
      values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return 'OK';
    },
    get: async (key: string) => live(key),
    mget: async (...keys: string[]) => keys.map((key) => live(key)),
    ttl: async (key: string) => {
      const row = values.get(key);
      if (!row) return -2;
      return Math.max(1, Math.ceil((row.expiresAt - Date.now()) / 1000));
    },
  } as unknown as Redis;
}

describe('RevocationStore user watermark', () => {
  it('rejects tokens issued at the role-change watermark and accepts a newer login', async () => {
    const store = new RevocationStore(memoryRedis());
    await store.revokeUser('user-tenant-admin', 900);

    const freshIat = await store.issuedAtForNewSession('user-tenant-admin');
    expect(await store.isRevoked('new-jti', 'user-tenant-admin', freshIat)).toBe(false);
    expect(await store.isRevoked('old-jti', 'user-tenant-admin', freshIat - 1)).toBe(true);
    expect(await store.isRevoked('missing-iat', 'user-tenant-admin')).toBe(true);
  });

  it('turns a legacy blanket revocation into a watermark when a new session starts', async () => {
    const redis = memoryRedis();
    await redis.set('revocation:user:user-2', '1', 'EX', 900);
    const store = new RevocationStore(redis);

    expect(await store.isRevoked('any', 'user-2', 1_700_000_000)).toBe(true);
    const freshIat = await store.issuedAtForNewSession('user-2');
    expect(await store.isRevoked('old', 'user-2', freshIat - 1)).toBe(true);
    expect(await store.isRevoked('new', 'user-2', freshIat)).toBe(false);
  });

  it('still revokes a single access token by jti', async () => {
    const store = new RevocationStore(memoryRedis());
    await store.revokeToken('jti-1', 60);
    expect(await store.isRevoked('jti-1', 'user-3', 1_700_000_000)).toBe(true);
    expect(await store.isRevoked('jti-2', 'user-3', 1_700_000_000)).toBe(false);
  });
});
