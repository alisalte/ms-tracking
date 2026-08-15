/**
 * Access-token revocation store — Redis-backed, shared by every service. Because
 * all services share the same Redis, a logout/role-change in identity-service
 * (writing `revocation:user:<uid>` or `revocation:<jti>`) is honored by every
 * downstream service on its next guarded request.
 *
 * Keys (Authentication.md §3.3):
 *   revocation:<jti>        Str  TTL = remaining access TTL  (single-token logout)
 *   revocation:user:<uid>   Str  TTL = short global TTL       (logout-all / role change)
 */
import type { Redis } from '@fleetvision/cache-redis';

export class RevocationStore {
  constructor(private readonly redis: Redis) {}

  /** Revoke a single access token by jti for the remainder of its TTL. */
  public async revokeToken(jti: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds > 0) {
      await this.redis.set(`revocation:${jti}`, '1', 'EX', ttlSeconds);
    }
  }

  /** Revoke all tokens for a user (logout-all / role change) — short global TTL. */
  public async revokeUser(userId: string, ttlSeconds = 900): Promise<void> {
    await this.redis.set(`revocation:user:${userId}`, '1', 'EX', ttlSeconds);
  }

  /** Is this jti or its user revoked? Returns false for missing keys. */
  public async isRevoked(jti: string, userId: string): Promise<boolean> {
    const [t, u] = await this.redis.mget(`revocation:${jti}`, `revocation:user:${userId}`);
    return t === '1' || u === '1';
  }
}
