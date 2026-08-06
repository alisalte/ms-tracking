/**
 * Cluster service — server-side H3 clustering for large fleets (08 §3.3, §6.3).
 *
 * Queries the latest position per vehicle within a bounding box, aggregates them
 * into H3 cells at a zoom-appropriate resolution, and returns ≤100 cluster
 * markers. Cached in Redis for 5s (long enough for panning, short enough for
 * freshness).
 */
import type { Knex } from '@fleetvision/persistence-knex';
import type { ClusterMarker } from '../domain/geo-types.js';
import { aggregateToClusters, zoomToResolution } from '../domain/h3-utils.js';
import type { RedisGeoCache } from '../infrastructure/cache/redis-geo-cache.js';

export interface ClusterServiceDeps {
  readonly knex: Knex;
  readonly cache: RedisGeoCache;
  readonly maxClusters: number;
}

export class ClusterService {
  constructor(private readonly deps: ClusterServiceDeps) {}

  /** Get clusters for a bbox + zoom level, with Redis caching. */
  public async getClusters(
    tenantId: string,
    minLng: number,
    minLat: number,
    maxLng: number,
    maxLat: number,
    zoom: number,
  ): Promise<ClusterMarker[]> {
    const bboxStr = `${minLng},${minLat},${maxLng},${maxLat}`;
    const cacheKey = this.deps.cache.clusterKey(tenantId, bboxStr, zoom);
    const cached = await this.deps.cache.get<ClusterMarker[]>(cacheKey);
    if (cached) return cached;

    // Query latest positions within the bbox from the hypertable.
    const bboxWkt = `SRID=4326;POLYGON((${minLng} ${minLat},${maxLng} ${minLat},${maxLng} ${maxLat},${minLng} ${maxLat},${minLng} ${minLat}))`;
    const rows = await this.deps
      .knex('tracking.vehicle_positions')
      .select('latitude', 'longitude')
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('geom && ?::geography', [bboxWkt])
      .where('quality', '>=', 1) // VALID or better
      .orderBy('captured_at', 'desc')
      .limit(5000); // cap the scan

    const points = (rows as { latitude: number; longitude: number }[]).map((r) => ({
      lat: Number(r.latitude),
      lng: Number(r.longitude),
    }));

    const resolution = zoomToResolution(zoom);
    const clusters = [...aggregateToClusters(points, resolution, this.deps.maxClusters)];

    await this.deps.cache.setCluster(cacheKey, clusters);
    return clusters;
  }
}
