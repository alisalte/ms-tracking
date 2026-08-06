import { simplify } from '../domain/douglas-peucker.js';
/**
 * Replay service — position history → simplified GeoJSON for map playback
 * (08 §12.5, §9.3).
 *
 * Three-tier routing by time range:
 *   ≤1d → raw hypertable scan (Sprint 9 primary path)
 *   1d–7d → continuous aggregate (documented extension point)
 *   >7d → S3 Parquet async (documented extension point)
 *
 * Applies Douglas-Peucker simplification (ε=5m) to reduce the polyline for
 * playback without visible fidelity loss. Cached in Redis 10min.
 */
import type { RedisGeoCache } from '../infrastructure/cache/redis-geo-cache.js';
import type {
  ReplayPoint,
  ReplayRepository,
} from '../infrastructure/persistence/replay.repository.js';

export interface ReplayServiceDeps {
  readonly replayRepo: ReplayRepository;
  readonly cache: RedisGeoCache;
  readonly replayCacheTtlSeconds: number;
}

/** GeoJSON FeatureCollection returned to the BFF / frontend. */
export interface ReplayResult {
  readonly type: 'FeatureCollection';
  readonly features: readonly ReplayFeature[];
  readonly metadata: {
    readonly pointCount: number;
    readonly simplifiedCount: number;
    readonly distanceKm: number;
    readonly durationSec: number;
  };
}

interface ReplayFeature {
  readonly type: 'Feature';
  readonly geometry: {
    readonly type: 'LineString';
    readonly coordinates: readonly number[][];
  };
  readonly properties: {
    readonly timings: readonly { ts: string; speed: number }[];
  };
}

export class ReplayService {
  constructor(private readonly deps: ReplayServiceDeps) {}

  public async getReplay(
    tenantId: string,
    vehicleId: string,
    from: Date,
    to: Date,
  ): Promise<ReplayResult> {
    const fromStr = from.toISOString();
    const toStr = to.toISOString();
    const cacheKey = this.deps.cache.replayKey(tenantId, vehicleId, fromStr, toStr);
    const cached = await this.deps.cache.get<ReplayResult>(cacheKey);
    if (cached) return cached;

    const points = await this.deps.replayRepo.findRange(tenantId, vehicleId, from, to);
    const result = this.buildReplayResult(points);
    await this.deps.cache.set(cacheKey, result, this.deps.replayCacheTtlSeconds);
    return result;
  }

  private buildReplayResult(points: ReplayPoint[]): ReplayResult {
    if (points.length === 0) {
      return {
        type: 'FeatureCollection',
        features: [],
        metadata: { pointCount: 0, simplifiedCount: 0, distanceKm: 0, durationSec: 0 },
      };
    }

    // Simplify with Douglas-Peucker (ε=5m).
    const simplified = simplify(
      points.map((p) => ({ lat: p.latitude, lng: p.longitude })),
      5,
    );

    // Build the GeoJSON LineString from simplified points.
    const coordinates = simplified.map((p) => [p.lng, p.lat]);

    // Timings from the original points (paired to simplified where possible).
    const timings = points.map((p) => ({
      ts: p.capturedAt.toISOString(),
      speed: p.speedKmh,
    }));

    // Compute distance + duration.
    const distanceKm = polylineDistanceKm(points);
    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];
    const durationSec =
      firstPoint && lastPoint
        ? (lastPoint.capturedAt.getTime() - firstPoint.capturedAt.getTime()) / 1000
        : 0;

    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates },
          properties: { timings },
        },
      ],
      metadata: {
        pointCount: points.length,
        simplifiedCount: simplified.length,
        distanceKm,
        durationSec,
      },
    };
  }
}

function polylineDistanceKm(points: ReplayPoint[]): number {
  const R = 6_371_000;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const phi1 = (a.latitude * Math.PI) / 180;
    const phi2 = (b.latitude * Math.PI) / 180;
    const dPhi = ((b.latitude - a.latitude) * Math.PI) / 180;
    const dLambda = ((b.longitude - a.longitude) * Math.PI) / 180;
    const h =
      Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
    total += R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  return total / 1000;
}
