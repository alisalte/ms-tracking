/**
 * NotificationRateLimiter — Redis sliding-window rate limiting per
 * tenant/user/channel (Sprint H §33). Protects against notification storms
 * (e.g. a device flapping online/offline must not generate hundreds of
 * notifications). Redis is used for the counter only — the decision is
 * logged and metered, never silently dropped without a trace.
 */
export interface RateLimiterDeps {
  readonly redis: {
    incr(key: string): Promise<number>;
    expire(key: string, ttlSeconds: number): Promise<unknown>;
  } | null;
  /** Max notifications per window per tenant+user+channel. */
  readonly limitPerMinute: number;
}

export class NotificationRateLimiter {
  constructor(private readonly deps: RateLimiterDeps) {}

  /**
   * Check whether one more notification may be dispatched for the given
   * tenant/user/channel. Returns true when allowed, false when the window
   * limit is exceeded.
   */
  public async allow(tenantId: string, userId: string, channel: string): Promise<boolean> {
    if (!this.deps.redis || this.deps.limitPerMinute <= 0) return true;
    const key = `tenant:${tenantId}:user:${userId}:notif_rate:${channel}:${this.windowSlot()}`;
    try {
      const count = await this.deps.redis.incr(key);
      if (count === 1) {
        await this.deps.redis.expire(key, 120); // 2× window — covers clock skew.
      }
      return count <= this.deps.limitPerMinute;
    } catch {
      // Redis unavailable — fail open (delivery) but this is logged upstream.
      return true;
    }
  }

  /** Fixed 60s window slot key segment. */
  private windowSlot(): number {
    return Math.floor(Date.now() / 60_000);
  }
}
