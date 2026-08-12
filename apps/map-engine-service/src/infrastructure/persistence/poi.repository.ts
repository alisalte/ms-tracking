/**
 * POI repository — `geo.pois` CRUD + spatial queries (08 §8.1; MapEngine.md §5.1).
 *
 * Uses PostGIS GiST index for nearest-K (`ORDER BY geom <-> point`) and bbox
 * queries. POIs are the Map Engine's canonical geometry store for named places.
 *
 * Latitude/longitude are extracted from the PostGIS `geom` column via ST_Y/ST_X
 * (not stored as separate columns), so every SELECT projects them explicitly.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import { withTenantContext } from '@fleetvision/persistence-knex';
import { MAX_PAGE_SIZE } from '@fleetvision/shared-kernel';
import type { Poi } from '../../domain/geo-types.js';

const SCHEMA = 'geo';
const TABLE = 'pois';

/** Projects lat/lng out of the geom column. Appended to every SELECT. */
const GEO_COLUMNS = [
  'poi_id',
  'tenant_id',
  'name',
  'category',
  'radius_m',
  'geofence_id',
  'metadata',
] as const;

interface PoiRow {
  poi_id: string;
  tenant_id: string | null;
  name: string;
  category: string;
  latitude: number | string;
  longitude: number | string;
  radius_m: number;
  geofence_id: string | null;
  metadata: Record<string, unknown> | string;
}

export class PoiRepository {
  constructor(private readonly knex: Knex) {}

  /** Create a POI. */
  public async create(input: {
    tenantId: string | null;
    name: string;
    category: string;
    latitude: number;
    longitude: number;
    radiusM?: number;
    geofenceId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<Poi> {
    // Platform POIs (tenantId null) are created via the platform client; tenant
    // POIs run under tenant context so the RLS WITH CHECK admits the row.
    const run = async (trx: Knex) => {
      const [row] = await trx
        .withSchema(SCHEMA)
        .from(TABLE)
        .insert({
          tenant_id: input.tenantId ? trx.raw('?::uuid', [input.tenantId]) : null,
          name: input.name,
          category: input.category,
          geom: trx.raw('?::geography', [`SRID=4326;POINT(${input.longitude} ${input.latitude})`]),
          radius_m: input.radiusM ?? 50,
          geofence_id: input.geofenceId ?? null,
          metadata: JSON.stringify(input.metadata ?? {}),
        })
        .returning([
          ...GEO_COLUMNS,
          trx.raw('ST_Y(geom::geometry) AS latitude'),
          trx.raw('ST_X(geom::geometry) AS longitude'),
        ]);
      return toPoi(row as PoiRow);
    };
    if (input.tenantId) {
      return withTenantContext(this.knex, input.tenantId, run);
    }
    return run(this.knex);
  }

  /** Find POIs within a bounding box (PostGIS && operator on GiST). */
  public async findInBbox(
    tenantId: string | null,
    minLng: number,
    minLat: number,
    maxLng: number,
    maxLat: number,
    category?: string,
    limit = MAX_PAGE_SIZE,
  ): Promise<Poi[]> {
    const bboxWkt = `SRID=4326;POLYGON((${minLng} ${minLat},${maxLng} ${minLat},${maxLng} ${maxLat},${minLng} ${maxLat},${minLng} ${minLat}))`;
    const effectiveLimit = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(limit)));
    const run = async (trx: Knex) => {
      let query = trx
        .withSchema(SCHEMA)
        .from(TABLE)
        .select(
          ...GEO_COLUMNS,
          trx.raw('ST_Y(geom::geometry) AS latitude'),
          trx.raw('ST_X(geom::geometry) AS longitude'),
        )
        .whereRaw('geom && ?::geography', [bboxWkt]);
      if (tenantId !== undefined && tenantId !== null) {
        query = query.where((q) => q.whereNull('tenant_id').orWhere('tenant_id', '=', tenantId));
      }
      if (category) {
        query = query.where('category', category);
      }
      // Deterministic order + cap so a bbox can never return an unbounded result
      // set (Phase 6 pagination guard).
      query = query.orderBy('name').limit(effectiveLimit);
      const rows = await query;
      return (rows as PoiRow[]).map(toPoi);
    };
    if (tenantId) {
      return withTenantContext(this.knex, tenantId, run);
    }
    return run(this.knex);
  }

  /** Nearest-K POIs to a point (PostGIS KNN: `ORDER BY geom <-> point`). */
  public async findNearest(
    latitude: number,
    longitude: number,
    radiusM: number,
    k: number,
    tenantId?: string,
  ): Promise<Array<Poi & { distanceM: number }>> {
    const pointWkt = `SRID=4326;POINT(${longitude} ${latitude})`;
    const run = async (trx: Knex) => {
      let query = trx
        .withSchema(SCHEMA)
        .from(TABLE)
        .select(
          ...GEO_COLUMNS,
          trx.raw('ST_Y(geom::geometry) AS latitude'),
          trx.raw('ST_X(geom::geometry) AS longitude'),
          trx.raw('ST_Distance(geom, ?::geography) AS distance_m', [pointWkt]),
        )
        .whereRaw('ST_DWithin(geom, ?::geography, ?)', [pointWkt, radiusM])
        .orderByRaw('geom <-> ?::geography', [pointWkt])
        .limit(k);
      if (tenantId !== undefined) {
        query = query.where((q) => q.whereNull('tenant_id').orWhere('tenant_id', '=', tenantId));
      }
      const rows = await query;
      return (rows as Array<PoiRow & { distance_m: number }>).map((r) => ({
        ...toPoi(r),
        distanceM: Number(r.distance_m),
      }));
    };
    if (tenantId) {
      return withTenantContext(this.knex, tenantId, run);
    }
    return run(this.knex);
  }

  /** Delete a POI by id. */
  public async delete(id: string): Promise<boolean> {
    const deleted = await this.knex.withSchema(SCHEMA).from(TABLE).where('poi_id', id).del();
    return deleted > 0;
  }
}

function toPoi(row: PoiRow): Poi {
  return {
    id: row.poi_id,
    tenantId: row.tenant_id,
    name: row.name,
    category: row.category,
    // Extracted from the PostGIS geom column (ST_Y=lat, ST_X=lng), not hardcoded 0.
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    radiusM: row.radius_m,
    geofenceId: row.geofence_id,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
  };
}
