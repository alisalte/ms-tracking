import type { Redis } from '@fleetvision/cache-redis';
import { describe, expect, it, jest } from '@jest/globals';
import { LoginUseCase } from '../application/auth/login.use-case.js';
import { InvalidCredentialsError } from '../domain/errors.js';
import { SessionStore } from '../infrastructure/cache/session-store.js';
import type { UserRepository } from '../infrastructure/persistence/user.repository.js';

/** Minimal Redis stand-in for session hash + set commands. */
function memoryRedis(): Redis {
  const hashes = new Map<string, Record<string, string>>();
  const sets = new Map<string, Set<string>>();
  const redis = {
    async hset(key: string, fields: Record<string, string | number>) {
      const current = hashes.get(key) ?? {};
      for (const [field, value] of Object.entries(fields)) current[field] = String(value);
      hashes.set(key, current);
    },
    async hgetall(key: string) {
      return hashes.get(key) ?? {};
    },
    async expire() {
      return 1;
    },
    async sadd(key: string, member: string) {
      const set = sets.get(key) ?? new Set<string>();
      set.add(member);
      sets.set(key, set);
      return 1;
    },
    async srem(key: string, member: string) {
      sets.get(key)?.delete(member);
      return 1;
    },
    async smembers(key: string) {
      return [...(sets.get(key) ?? [])];
    },
    async del(...keys: string[]) {
      for (const key of keys) {
        hashes.delete(key);
        sets.delete(key);
      }
      return keys.length;
    },
  };
  return redis as unknown as Redis;
}

function store() {
  return new SessionStore(memoryRedis());
}

const future = Date.now() + 60 * 60 * 1000;

async function open(
  sessions: SessionStore,
  sessionId: string,
  userId: string,
  tenantId: string,
  issuedAt: number,
) {
  await sessions.create(
    {
      sessionId,
      userId,
      tenantId,
      refreshFamilyId: `fam-${sessionId}`,
      issuedAt,
      absoluteExpiresAt: future,
    },
    1800,
    3600,
  );
}

describe('session room for a new sign-in', () => {
  it('closes the same user leftover sessions before counting the tenant cap', async () => {
    const sessions = store();
    await open(sessions, 's1', 'user-1', 'tenant-1', 1);
    await open(sessions, 's2', 'user-1', 'tenant-1', 2);
    expect(await sessions.countForTenant('tenant-1')).toBe(2);

    await sessions.makeRoom('tenant-1', 'user-1', 1);

    expect(await sessions.countForTenant('tenant-1')).toBe(0);
    expect(await sessions.get('s1')).toBeNull();
    expect(await sessions.get('s2')).toBeNull();
  });

  it('drops the oldest other session when the license cap is already full', async () => {
    const sessions = store();
    await open(sessions, 'old', 'other-1', 'tenant-1', 10);
    await open(sessions, 'newer', 'other-2', 'tenant-1', 20);

    await sessions.makeRoom('tenant-1', 'user-1', 2);

    expect(await sessions.get('old')).toBeNull();
    expect(await sessions.get('newer')).not.toBeNull();
    expect(await sessions.countForTenant('tenant-1')).toBe(1);
  });

  it('does not count a session that is past its absolute expiry', async () => {
    const sessions = store();
    await sessions.create(
      {
        sessionId: 'stale',
        userId: 'user-9',
        tenantId: 'tenant-1',
        refreshFamilyId: 'fam-stale',
        issuedAt: 1,
        absoluteExpiresAt: Date.now() - 1000,
      },
      1800,
      3600,
    );

    expect(await sessions.countForTenant('tenant-1')).toBe(0);
    expect(await sessions.get('stale')).toBeNull();
  });
});

describe('login makes room only after the password matches', () => {
  const license = {
    maxConcurrentSessions: 1,
    sessionIdleMinutes: 30,
    sessionAbsoluteHours: 8,
  };
  const config = {
    accessTtlSeconds: 60,
    refreshTtlSeconds: 60,
    maxAttempts: 5,
    lockoutSeconds: 60,
    rateLimitPerIp: 10,
    rateLimitPerUser: 5,
  };

  function build(verify: boolean) {
    const makeRoom = jest.fn(async () => undefined);
    const user = {
      id: 'user-1',
      tenantId: 'tenant-1',
      email: 'a@b.c',
      passwordHash: 'hash',
      recordFailedLogin: () => ({ locked: false }),
      recordSuccessfulLogin: () => undefined,
    };
    const users = {
      findByEmail: async () => user,
      findByUsernameInTenant: async () => null,
      save: async () => undefined,
    } as unknown as UserRepository;
    const login = new LoginUseCase(
      users,
      { findById: async () => ({ isActive: () => true, name: 'Acme', tier: 'STANDARD' }) } as never,
      {} as never,
      { verify: async () => verify } as never,
      {
        issuePair: async () => {
          throw new Error('tokens-issued');
        },
      } as never,
      { makeRoom } as never,
      { hitLoginUser: async () => 1, isLocked: async () => false } as never,
      {
        permissionsForUser: async () => [],
        namesForUser: async () => ['viewer'],
      } as never,
      { assertLoginAllowed: async () => license } as never,
      config,
    );
    return { login, makeRoom };
  }

  it('does not close sessions when the password is wrong', async () => {
    const { login, makeRoom } = build(false);
    await expect(
      login.execute({
        email: 'a@b.c',
        password: 'wrong',
        tenantId: 'tenant-1',
        ipAddress: null,
        userAgent: null,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(makeRoom).not.toHaveBeenCalled();
  });

  it('frees a slot before issuing tokens when the password matches', async () => {
    const { login, makeRoom } = build(true);
    await expect(
      login.execute({
        email: 'a@b.c',
        password: 'right',
        tenantId: 'tenant-1',
        ipAddress: null,
        userAgent: null,
      }),
    ).rejects.toThrow('tokens-issued');
    expect(makeRoom).toHaveBeenCalledWith('tenant-1', 'user-1', 1);
  });
});
