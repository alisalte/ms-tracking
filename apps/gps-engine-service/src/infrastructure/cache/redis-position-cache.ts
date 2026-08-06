/**
 * Redis last-position cache (07 §13.5, 03 §18.1).
 *
 * Stores the latest position per vehicle under
 * `tenant:<tid>:vehicle:<vid>:pos` as JSON, with a TTL of 2× the reporting
 * interval (the key expires if the device stops reporting). Write-through on
 * ingest; the API reads this first and falls back to TimescaleDB on miss.
 */
import type { Redis } from '@fleetvision/cache-redis';
import type { PositionEvent } from '../../domain/position-event.js';
import type { LatestPosition } from '../persistence/position.repository.js';

/** JSON shape stored in Redis (compact keys for the hot path). */
interface CachedPosition {
  readonly lat: number;
  readonly lng: number;
  readonly spd: number;
  readonly hdg: number;
  readonly alt: number | null;
  readonly ign: boolean | null;
  readonly ts: string; // ISO captured-at
}

export class RedisPositionCache {
  /** TTL in seconds (2× reporting interval, 07 §13.5). */
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: Redis,
    reportIntervalSeconds = 60,
  ) {
    this.ttlSeconds = reportIntervalSeconds * 2;
  }

  private key(tenantId: string, vehicleId: string): string {
    return `tenant:${tenantId}:vehicle:${vehicleId}:pos`;
  }

  /** Write-through the latest position on ingest (best-effort; never throws). */
  public async setLatest(event: PositionEvent): Promise<void> {
    const value: CachedPosition = {
      lat: event.latitude,
      lng: event.longitude,
      spd: event.speedKph,
      hdg: event.headingDeg,
      alt: event.altitudeM,
      ign: event.ignitionOn,
      ts: event.capturedAt.toISOString(),
    };
    try {
      await this.redis.set(
        this.key(event.tenantId, event.vehicleId),
        JSON.stringify(value),
        'EX',
        this.ttlSeconds,
      );
    } catch {
      /* best-effort — Redis may be down; cache miss falls back to DB */
    }
  }

  /** Read the latest position; null on miss or Redis error. */
  public async getLatest(tenantId: string, vehicleId: string): Promise<LatestPosition | null> {
    try {
      const raw = await this.redis.get(this.key(tenantId, vehicleId));
      if (!raw) return null;
      return fromCached(raw, tenantId, vehicleId);
    } catch {
      return null;
    }
  }

  // --- Previous position (07 §13.5 `:prevpos`) — for derivation/mileage/distance. ---

  private prevKey(tenantId: string, vehicleId: string): string {
    return `tenant:${tenantId}:vehicle:${vehicleId}:prevpos`;
  }

  /** Store the previous position alongside the latest (same TTL). Best-effort. */
  public async setPrevPos(event: PositionEvent): Promise<void> {
    const value: CachedPosition = {
      lat: event.latitude,
      lng: event.longitude,
      spd: event.speedKph,
      hdg: event.headingDeg,
      alt: event.altitudeM,
      ign: event.ignitionOn,
      ts: event.capturedAt.toISOString(),
    };
    try {
      await this.redis.set(
        this.prevKey(event.tenantId, event.vehicleId),
        JSON.stringify(value),
        'EX',
        this.ttlSeconds,
      );
    } catch {
      /* best-effort */
    }
  }

  /** Read the previous position as a LatestPosition; null on miss. */
  public async getPrevPos(tenantId: string, vehicleId: string): Promise<LatestPosition | null> {
    try {
      const raw = await this.redis.get(this.prevKey(tenantId, vehicleId));
      if (!raw) return null;
      return fromCached(raw, tenantId, vehicleId);
    } catch {
      return null;
    }
  }
}

function fromCached(raw: string, tenantId: string, vehicleId: string): LatestPosition {
  const c = JSON.parse(raw) as CachedPosition;
  return {
    vehicleId,
    tenantId,
    latitude: c.lat,
    longitude: c.lng,
    speedKph: c.spd,
    headingDeg: c.hdg,
    altitudeM: c.alt,
    ignitionOn: c.ign,
    capturedAt: new Date(c.ts),
    ingestedAt: new Date(c.ts),
    quality: 1,
  };
}
