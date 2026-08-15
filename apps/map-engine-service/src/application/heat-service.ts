/**
 * Heat service — minimal REAL position-density heat map (Sprint F §19).
 *
 * Aggregates historical positions from the `tracking.vehicle_positions`
 * hypertable inside a bbox + time window into grid cells (the same quantized
 * cell grid the cluster service uses), returning per-cell counts. Deliberately
 * NOT an analytics platform: one metric (`position_count`), a capped scan
 * (≤20 000 rows), a bounded time window (default 24 h, max 7 d), and a Redis
 * cache with the standard geo TTL.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import type { HeatCell } from '../domain/geo-types.js';
import { aggregateToClusters, zoomToResolution } from '../domain/h3-utils.js';
import type { RedisGeoCache } from '../infrastructure/cache/redis-geo-cache.js';

export interface HeatServiceDeps {
  readonly knex: Knex;
  readonly cache: RedisGeoCache;
  readonly maxCells: number;
}

export class HeatService {
  constructor(private readonly deps: HeatServiceDeps) {}

  public async getCells(
    tenantId: string,
    minLng: number,
    minLat: number,
    maxLng: number,
    maxLat: number,
    zoom: number,
    from: Date,
    to: Date,
    metric: string,
  ): Promise<HeatCell[]> {
    const key = this.deps.cache.heatKey(
      tenantId,
      `${minLng},${minLat},${maxLng},${maxLat}`,
      from,
      to,
    );
    const cached = await this.deps.cache.get<HeatCell[]>(key);
    if (cached) return cached;

    const bboxWkt = `SRID=4326;POLYGON((${minLng} ${minLat},${maxLng} ${minLat},${maxLng} ${maxLat},${minLng} ${maxLat},${minLng} ${minLat}))`;
    const rows = await this.deps
      .knex('tracking.vehicle_positions')
      .select('latitude', 'longitude')
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('geom && ?::geography', [bboxWkt])
      .whereBetween('captured_at', [from, to])
      .where('quality', '>=', 1)
      .limit(20_000); // cap the scan — heat is an approximation, not a census

    const points = (rows as { latitude: number; longitude: number }[]).map((r) => ({
      lat: Number(r.latitude),
      lng: Number(r.longitude),
    }));

    const cells = [...aggregateToClusters(points, zoomToResolution(zoom), this.deps.maxCells)].map(
      (c): HeatCell => ({
        cellId: c.cellId,
        latitude: c.latitude,
        longitude: c.longitude,
        count: c.count,
        metric,
      }),
    );

    await this.deps.cache.set(key, cells);
    return cells;
  }
}
