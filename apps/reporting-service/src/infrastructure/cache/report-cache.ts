/**
 * Report cache (Sprint J §42/§43) — bounded-TTL Redis caching for the
 * fleet-overview + trend endpoints.
 *
 * Keys include tenant + every filter + the time window (no cross-tenant
 * leakage possible). Strategy is deliberately SIMPLE: short TTL (default 30 s)
 * + explicit refresh from the UI; no complex invalidation. Cached responses
 * are labeled `freshness: 'NEAR_REALTIME'` with a `dataAsOf` timestamp so the
 * UI can communicate staleness.
 */
import { createHash } from 'node:crypto';
import type { Redis } from '@fleetvision/cache-redis';

export class ReportCache {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  /** Cache key: `report:<name>:<tenant>:<sha(filters+window)>` — tenant-bound. */
  public static key(
    report: string,
    tenantId: string,
    filters: Record<string, unknown>,
  ): string {
    const canonical = JSON.stringify(
      Object.keys(filters)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = filters[k];
          return acc;
        }, {}),
    );
    const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 16);
    return `report:${report}:${tenantId}:${hash}`;
  }

  public async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null; // Redis down → compute on demand (best-effort cache)
    }
  }

  public async set<T>(key: string, value: T): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', this.ttlSeconds);
    } catch {
      /* best-effort */
    }
  }
}

/** Fixed-window rate limiter for expensive exports (§69 — per tenant+user). */
export class ExportRateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly limit: number,
    private readonly windowSeconds: number,
  ) {}

  /** Returns true when the request is allowed (and counts it). */
  public async allow(tenantId: string, userId: string): Promise<boolean> {
    try {
      const key = `report:exportrl:${tenantId}:${userId}`;
      const n = await this.redis.incr(key);
      if (n === 1) {
        await this.redis.expire(key, this.windowSeconds);
      }
      return n <= this.limit;
    } catch {
      return true; // Redis down → fail open (export remains auth + timeout bounded)
    }
  }
}
