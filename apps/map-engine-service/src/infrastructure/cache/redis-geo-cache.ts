import { createHash } from 'node:crypto';
/**
 * Redis geo cache — the three-tier caching layer for map-provider results
 * (08 §6.1).
 *
 * Keys (namespaced for cache isolation):
 *   geo:rev:<lat>:<lng>           — reverse geocode (TTL: config MAP_CACHE_TTL_SECONDS)
 *   geo:fwd:<sha256(query)>       — forward geocode
 *   geo:route:<sha256(waypoints)> — route result
 *   geo:snap:<lat>:<lng>          — snapped point
 *   geo:cluster:<tenant>:<fleet>:<bbox>:<zoom> — cluster markers (5s TTL)
 *
 * All operations are best-effort (Redis down → cache miss → DB/provider query).
 */
import type { Redis } from '@fleetvision/cache-redis';

export class RedisGeoCache {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds = 300,
    private readonly clusterTtlSeconds = 5,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds ?? this.ttlSeconds);
    } catch {
      /* best-effort */
    }
  }

  // --- Typed convenience methods ---

  revKey(lat: number, lng: number): string {
    return `geo:rev:${lat.toFixed(5)}:${lng.toFixed(5)}`;
  }

  fwdKey(query: string): string {
    return `geo:fwd:${sha(query)}`;
  }

  routeKey(waypoints: readonly { lat: number; lng: number }[], mode: string): string {
    return `geo:route:${mode}:${sha(waypoints.map((w) => `${w.lat},${w.lng}`).join('|'))}`;
  }

  snapKey(lat: number, lng: number): string {
    return `geo:snap:${lat.toFixed(5)}:${lng.toFixed(5)}`;
  }

  clusterKey(tenantId: string, bbox: string, zoom: number): string {
    return `geo:cluster:${tenantId}:${bbox}:${zoom}`;
  }

  replayKey(tenantId: string, vehicleId: string, from: string, to: string): string {
    return `geo:replay:${tenantId}:${vehicleId}:${sha(from + to)}`;
  }

  /** Heat-map density cells (Sprint F §19). */
  heatKey(tenantId: string, bbox: string, from: Date, to: Date): string {
    return `geo:heat:${tenantId}:${bbox}:${sha(from.toISOString() + to.toISOString())}`;
  }

  /** Cluster cache uses the shorter TTL. */
  async setCluster<T>(key: string, value: T): Promise<void> {
    await this.set(key, value, this.clusterTtlSeconds);
  }
}

function sha(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}
