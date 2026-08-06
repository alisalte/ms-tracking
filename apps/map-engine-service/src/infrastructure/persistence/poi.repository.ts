/**
 * POI repository — `geo.pois` CRUD + spatial queries (08 §8.1; MapEngine.md §5.1).
 *
 * Uses PostGIS GiST index for nearest-K (`ORDER BY geom <-> point`) and bbox
 * queries. POIs are the Map Engine's canonical geometry store for named places.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import type { Poi } from '../../domain/geo-types.js';

const SCHEMA = 'geo';
const TABLE = 'pois';

interface PoiRow {
  poi_id: string;
  tenant_id: string | null;
  name: string;
  category: string;
  geom: unknown;
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
    const [row] = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .insert({
        tenant_id: input.tenantId ? this.knex.raw('?::uuid', [input.tenantId]) : null,
        name: input.name,
        category: input.category,
        geom: this.knex.raw('?::geography', [
          `SRID=4326;POINT(${input.longitude} ${input.latitude})`,
        ]),
        radius_m: input.radiusM ?? 50,
        geofence_id: input.geofenceId ?? null,
        metadata: JSON.stringify(input.metadata ?? {}),
      })
      .returning('*');
    return toPoi(row as PoiRow);
  }

  /** Find POIs within a bounding box (PostGIS && operator on GiST). */
  public async findInBbox(
    tenantId: string | null,
    minLng: number,
    minLat: number,
    maxLng: number,
    maxLat: number,
    category?: string,
  ): Promise<Poi[]> {
    const bboxWkt = `SRID=4326;POLYGON((${minLng} ${minLat},${maxLng} ${minLat},${maxLng} ${maxLat},${minLng} ${maxLat},${minLng} ${minLat}))`;
    let query = this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('geom && ?::geography', [bboxWkt]);
    if (tenantId !== undefined) {
      query = query.where((q) => q.whereNull('tenant_id').orWhere('tenant_id', '=', tenantId));
    }
    if (category) {
      query = query.where('category', category);
    }
    const rows = await query;
    return (rows as PoiRow[]).map(toPoi);
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
    let query = this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .select('*', this.knex.raw('ST_Distance(geom, ?::geography) AS distance_m', [pointWkt]))
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
    latitude: 0, // extracted from geom if needed; for Sprint 9 the callers use the query point
    longitude: 0,
    radiusM: row.radius_m,
    geofenceId: row.geofence_id,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
  };
}
