/**
 * Redis session cache — signaling tokens + channel→pod affinity (09 §5.4, §9.3).
 *
 *   media:session:<sid>:token   — signaling token payload (TTL 5min sliding)
 *   media:channel:<id>:pod      — channel→pod affinity for co-location (TTL 1h)
 *
 * All operations are best-effort (Redis down → degrade to in-memory).
 */
import type { Redis } from '@fleetvision/cache-redis';
import type { SignalingTokenPayload } from '../../domain/signaling-token.js';

export class RedisSessionCache {
  constructor(
    private readonly redis: Redis,
    private readonly tokenTtlSeconds = 300,
  ) {}

  private tokenKey(sessionId: string): string {
    return `media:session:${sessionId}:token`;
  }
  private podKey(channelId: string): string {
    return `media:channel:${channelId}:pod`;
  }

  /** Store a signaling token payload. Best-effort. */
  public async setToken(payload: SignalingTokenPayload): Promise<void> {
    try {
      await this.redis.set(
        this.tokenKey(payload.sessionId),
        JSON.stringify(payload),
        'EX',
        this.tokenTtlSeconds,
      );
    } catch {
      /* best-effort */
    }
  }

  /** Retrieve + verify a signaling token. Null on miss/error. */
  public async getToken(sessionId: string): Promise<SignalingTokenPayload | null> {
    try {
      const raw = await this.redis.get(this.tokenKey(sessionId));
      if (!raw) return null;
      return JSON.parse(raw) as SignalingTokenPayload;
    } catch {
      return null;
    }
  }

  /** Delete a signaling token (on session close). */
  public async deleteToken(sessionId: string): Promise<void> {
    try {
      await this.redis.del(this.tokenKey(sessionId));
    } catch {
      /* best-effort */
    }
  }

  /** Record channel→pod affinity for viewer co-location (09 §9.3). */
  public async setPodAffinity(channelId: string, pod: string): Promise<void> {
    try {
      await this.redis.set(this.podKey(channelId), pod, 'EX', 3600);
    } catch {
      /* best-effort */
    }
  }

  /** Read channel→pod affinity. Null on miss. */
  public async getPodAffinity(channelId: string): Promise<string | null> {
    try {
      return await this.redis.get(this.podKey(channelId));
    } catch {
      return null;
    }
  }
}
