import { describe, expect, it } from '@jest/globals';
import { ReplayService } from '../application/replay-service.js';
import type { RedisGeoCache } from '../infrastructure/cache/redis-geo-cache.js';
import type {
  ReplayPoint,
  ReplayRepository,
} from '../infrastructure/persistence/replay.repository.js';

const T0 = new Date('2026-08-06T10:00:00Z');
const T1 = new Date('2026-08-06T10:01:00Z');
const T2 = new Date('2026-08-06T10:02:00Z');

/** Fake replay repo — returns a pre-set list of points. */
class FakeReplayRepo {
  constructor(private readonly points: ReplayPoint[]) {}
  async findRange(): Promise<ReplayPoint[]> {
    return this.points;
  }
}

/** Fake cache — always misses. */
class FakeCache {
  async get(): Promise<null> {
    return null;
  }
  async set(): Promise<void> {}
  replayKey(): string {
    return 'replay:test';
  }
}

function buildPoint(lat: number, lng: number, at: Date, speed = 30): ReplayPoint {
  return {
    latitude: lat,
    longitude: lng,
    speedKmh: speed,
    headingDeg: 0,
    capturedAt: at,
    ignitionOn: true,
  };
}

describe('ReplayService (08 §12.5, §9.3)', () => {
  it('builds a GeoJSON FeatureCollection from position history', async () => {
    const points = [
      buildPoint(22.9, 113.4, T0),
      buildPoint(22.9001, 113.4001, T1),
      buildPoint(22.9002, 113.4002, T2),
    ];
    const svc = new ReplayService({
      replayRepo: new FakeReplayRepo(points) as unknown as ReplayRepository,
      cache: new FakeCache() as unknown as RedisGeoCache,
      replayCacheTtlSeconds: 600,
    });

    const result = await svc.getReplay('t1', 'v1', T0, T2);

    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(1);
    expect(result.features[0]?.geometry.type).toBe('LineString');
    expect(result.features[0]?.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(result.metadata.pointCount).toBe(3);
  });

  it('returns an empty collection when no positions exist', async () => {
    const svc = new ReplayService({
      replayRepo: new FakeReplayRepo([]) as unknown as ReplayRepository,
      cache: new FakeCache() as unknown as RedisGeoCache,
      replayCacheTtlSeconds: 600,
    });

    const result = await svc.getReplay('t1', 'v1', T0, T2);
    expect(result.features).toHaveLength(0);
    expect(result.metadata.pointCount).toBe(0);
  });

  it('computes distance and duration metadata', async () => {
    const points = [
      buildPoint(22.9, 113.4, T0),
      buildPoint(22.91, 113.4, T1), // ~1.1km north, 60s later
    ];
    const svc = new ReplayService({
      replayRepo: new FakeReplayRepo(points) as unknown as ReplayRepository,
      cache: new FakeCache() as unknown as RedisGeoCache,
      replayCacheTtlSeconds: 600,
    });

    const result = await svc.getReplay('t1', 'v1', T0, T1);
    expect(result.metadata.distanceKm).toBeGreaterThan(1);
    expect(result.metadata.durationSec).toBe(60);
  });

  it('applies Douglas-Peucker simplification to reduce coordinates', async () => {
    // 50 nearly-collinear points → should simplify significantly.
    const points = Array.from({ length: 50 }, (_, i) =>
      buildPoint(22.9 + i * 0.000001, 113.4 + i * 0.000001, new Date(T0.getTime() + i * 1000)),
    );
    const svc = new ReplayService({
      replayRepo: new FakeReplayRepo(points) as unknown as ReplayRepository,
      cache: new FakeCache() as unknown as RedisGeoCache,
      replayCacheTtlSeconds: 600,
    });

    const result = await svc.getReplay('t1', 'v1', T0, new Date(T0.getTime() + 49_000));
    expect(result.metadata.simplifiedCount).toBeLessThan(result.metadata.pointCount);
  });
});
