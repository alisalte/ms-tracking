/**
 * Redis-backed stores for auth hot-path state. Redis is the source of truth for
 * session liveness, token revocation, rate limits, and lockouts; Postgres is
 * the durable forensic mirror (03 §18 / Authentication.md §3.3).
 *
 * Keys (Authentication.md §3.3):
 *   session:<id>            Hash  TTL = idle timeout
 *   session:user:<uid>      Set   TTL = absolute expiry (for logout-all)
 *   revocation:<jti>        Str   TTL = remaining access TTL
 *   revocation:user:<uid>   Str   TTL = short (global logout, < 60s propagation)
 *   refresh:<hash>          Str   TTL = refresh TTL (mirror for fast reuse check)
 *   ratelimit:login:ip:<ip>       token bucket
 *   ratelimit:login:user:<uid>    sliding window
 *   lockout:<uid>           Str   TTL = lockout TTL
 *   failedlogin:<uid>       Cntr  TTL = 15m
 */
import type { Redis } from '@fleetvision/cache-redis';

export interface SessionData {
  readonly sessionId: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly refreshFamilyId: string;
  readonly issuedAt: number;
  readonly absoluteExpiresAt: number;
}

export class SessionStore {
  constructor(private readonly redis: Redis) {}

  /** Create a session + index it under the user (for logout-all). */
  public async create(
    data: SessionData,
    idleTtlSeconds: number,
    absoluteTtlSeconds: number,
  ): Promise<void> {
    const key = `session:${data.sessionId}`;
    const userKey = `session:user:${data.userId}`;
    await this.redis.hset(key, {
      session_id: data.sessionId,
      user_id: data.userId,
      tenant_id: data.tenantId,
      refresh_family_id: data.refreshFamilyId,
      issued_at: data.issuedAt,
      absolute_expires_at: data.absoluteExpiresAt,
    });
    await this.redis.expire(key, idleTtlSeconds);
    await this.redis.sadd(userKey, data.sessionId);
    await this.redis.expire(userKey, absoluteTtlSeconds);
  }

  public async get(sessionId: string): Promise<SessionData | null> {
    const raw = (await this.redis.hgetall(`session:${sessionId}`)) as Record<string, string>;
    const { session_id, user_id, tenant_id, refresh_family_id, issued_at, absolute_expires_at } =
      raw;
    if (!session_id || !user_id || !tenant_id || !refresh_family_id) return null;
    return {
      sessionId: session_id,
      userId: user_id,
      tenantId: tenant_id,
      refreshFamilyId: refresh_family_id,
      issuedAt: Number(issued_at ?? 0),
      absoluteExpiresAt: Number(absolute_expires_at ?? 0),
    };
  }

  /** Revoke a single session (logout). */
  public async revoke(sessionId: string): Promise<void> {
    const data = await this.get(sessionId);
    await this.redis.del(`session:${sessionId}`);
    if (data) {
      await this.redis.srem(`session:user:${data.userId}`, sessionId);
    }
  }

  /** Revoke all sessions for a user (logout-all). */
  public async revokeAllForUser(userId: string): Promise<string[]> {
    const sessionIds = await this.redis.smembers(`session:user:${userId}`);
    if (sessionIds.length > 0) {
      await this.redis.del(...sessionIds.map((id) => `session:${id}`));
    }
    await this.redis.del(`session:user:${userId}`);
    return sessionIds;
  }
}

/**
 * Access-token revocation lookups (checked on every guarded request). Sprint B:
 * the canonical `RevocationStore` now lives in `@fleetvision/auth` so every
 * service shares the same Redis-backed store (a logout/role-change in identity
 * is honored by all downstream services). Re-exported here to keep identity's
 * existing import paths (`../../infrastructure/cache/session-store.js`) intact.
 */
export { RevocationStore } from '@fleetvision/auth';

/** Refresh-token reuse fast-path mirror. */
export class RefreshStore {
  constructor(private readonly redis: Redis) {}

  public async markConsumed(tokenHash: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(`refresh:${tokenHash}`, 'consumed', 'EX', ttlSeconds);
  }

  public async isConsumed(tokenHash: string): Promise<boolean> {
    return (await this.redis.get(`refresh:${tokenHash}`)) === 'consumed';
  }
}

/** Login rate limiting + brute-force lockout (AUTH-BR-03, §9.5). */
export class RateLimiterStore {
  constructor(private readonly redis: Redis) {}

  /** Sliding-window-ish counter; returns the count after increment. */
  public async hitLoginIp(ip: string, windowSeconds = 60): Promise<number> {
    const key = `ratelimit:login:ip:${ip}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, windowSeconds);
    return count;
  }

  public async hitLoginUser(userId: string, windowSeconds = 60): Promise<number> {
    const key = `ratelimit:login:user:${userId}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, windowSeconds);
    return count;
  }

  /** Track failed attempts; returns the new count. */
  public async recordFailedLogin(userId: string, windowSeconds = 900): Promise<number> {
    const key = `failedlogin:${userId}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, windowSeconds);
    return count;
  }

  public async resetFailedLogin(userId: string): Promise<void> {
    await this.redis.del(`failedlogin:${userId}`);
  }

  public async setLockout(userId: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(`lockout:${userId}`, '1', 'EX', ttlSeconds);
  }

  public async isLocked(userId: string): Promise<boolean> {
    return (await this.redis.get(`lockout:${userId}`)) === '1';
  }
}
