/**
 * Access-token revocation store — Redis-backed, shared by every service. Because
 * all services share the same Redis, a logout/role-change in identity-service
 * (writing `revocation:user:<uid>` or `revocation:<jti>`) is honored by every
 * downstream service on its next guarded request.
 *
 * Keys (Authentication.md §3.3):
 *   revocation:<jti>        Str  TTL = remaining access TTL  (single-token logout)
 *   revocation:user:<uid>   Str  unix-second watermark        (logout-all / role change)
 *                                Legacy value "1" still revokes every token.
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

  /**
   * Revoke access tokens issued at or before this moment (logout-all, role
   * change, account suspension). The value is a unix-second watermark, not a
   * blanket flag: a later login or refresh can mint a token with a newer
   * `iat` and keep working. TTL covers the longest access token still alive.
   */
  public async revokeUser(userId: string, ttlSeconds = 900): Promise<void> {
    const watermark = Math.floor(Date.now() / 1000);
    await this.redis.set(`revocation:user:${userId}`, String(watermark), 'EX', ttlSeconds);
  }

  /**
   * `iat` for a token that must outlive an existing user watermark.
   * A legacy blanket value (`"1"`) is replaced with the current second so
   * previously issued tokens stay dead and this new session is accepted.
   */
  public async issuedAtForNewSession(userId: string): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    const key = `revocation:user:${userId}`;
    const raw = await this.redis.get(key);
    if (raw == null || raw === '') return now;
    if (raw === '1') {
      const ttl = await this.redis.ttl(key);
      await this.redis.set(key, String(now), 'EX', ttl > 0 ? ttl : 900);
      return now + 1;
    }
    const watermark = Number(raw);
    if (!Number.isFinite(watermark)) return now + 1;
    return Math.max(now, watermark + 1);
  }

  /**
   * Is this jti revoked, or was this access token issued at or before the
   * user's revocation watermark? A missing `issuedAtSeconds` against a
   * numeric watermark fails closed. Legacy value `"1"` still revokes every
   * token for that user.
   */
  public async isRevoked(jti: string, userId: string, issuedAtSeconds?: number): Promise<boolean> {
    const [t, u] = await this.redis.mget(`revocation:${jti}`, `revocation:user:${userId}`);
    if (t === '1') return true;
    if (u == null || u === '') return false;
    if (u === '1') return true;
    const watermark = Number(u);
    if (!Number.isFinite(watermark)) return true;
    if (issuedAtSeconds == null || !Number.isFinite(issuedAtSeconds)) return true;
    return issuedAtSeconds <= watermark;
  }
}
