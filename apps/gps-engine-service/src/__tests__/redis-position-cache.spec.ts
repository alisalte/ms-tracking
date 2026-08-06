import { describe, expect, it } from '@jest/globals';
import { PositionEvent } from '../domain/position-event.js';
import { RedisPositionCache } from '../infrastructure/cache/redis-position-cache.js';

const NOW = new Date('2026-08-06T10:00:00Z');

/** Minimal fake Redis — records SET/GET calls (no real server). */
class FakeRedis {
  public store = new Map<string, string>();
  public ttls = new Map<string, number>();
  async set(key: string, value: string, _mode: string, ttl: number): Promise<string> {
    this.store.set(key, value);
    this.ttls.set(key, ttl);
    return 'OK';
  }
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
}

function buildEvent(): PositionEvent {
  return new PositionEvent({
    messageId: 'msg-1',
    vehicleId: 'dev-001',
    tenantId: 'tenant-001',
    latitude: 22.9382,
    longitude: 113.3827,
    speedKph: 42,
    headingDeg: 180,
    altitudeM: 55,
    satellites: 8,
    ignitionOn: true,
    capturedAt: NOW,
    ingestedAt: NOW,
    protocolId: 'gt06',
    quality: 'VALID',
  });
}

describe('RedisPositionCache (07 §13.5)', () => {
  it('writes to the canonical key with the 2x-interval TTL', async () => {
    const redis = new FakeRedis();
    const cache = new RedisPositionCache(redis as never, 60); // 60s interval
    await cache.setLatest(buildEvent());
    const key = 'tenant:tenant-001:vehicle:dev-001:pos';
    expect(redis.store.has(key)).toBe(true);
    expect(redis.ttls.get(key)).toBe(120); // 2 × 60s
  });

  it('round-trips set → get with correct field values', async () => {
    const redis = new FakeRedis();
    const cache = new RedisPositionCache(redis as never, 60);
    await cache.setLatest(buildEvent());
    const latest = await cache.getLatest('tenant-001', 'dev-001');
    expect(latest).not.toBeNull();
    expect(latest?.latitude).toBeCloseTo(22.9382, 4);
    expect(latest?.longitude).toBeCloseTo(113.3827, 4);
    expect(latest?.speedKph).toBe(42);
    expect(latest?.ignitionOn).toBe(true);
    expect(latest?.capturedAt.toISOString()).toBe(NOW.toISOString());
  });

  it('returns null on a cache miss', async () => {
    const redis = new FakeRedis();
    const cache = new RedisPositionCache(redis as never, 60);
    expect(await cache.getLatest('tenant-001', 'dev-999')).toBeNull();
  });
});
