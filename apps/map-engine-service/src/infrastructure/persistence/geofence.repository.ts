/**
 * Geofence repository — `tracking.geofences` CRUD + spatial queries
 * (08 §4; 03 §17.2).
 *
 * The Map Engine owns the geometry store + CRUD. The GPS Engine owns live
 * evaluation — this repo provides the `containsPoint()` query the GPS Engine's
 * geofence FSM calls (PostGIS `ST_Covers`).
 */
import type { Knex } from '@fleetvision/persistence-knex';
import { withTenantContext } from '@fleetvision/persistence-knex';
import { type Page, toCursor } from '@fleetvision/shared-kernel';
import type { Geofence } from '../../domain/geo-types.js';

const SCHEMA = 'tracking';
const TABLE = 'geofences';

interface GeofenceRow {
  id: string;
  tenant_id: string;
  name: string;
  geofence_type: string;
  boundary: unknown;
  center: unknown;
  radius_m: number | null;
  alert_on: string[] | unknown;
  dwell_sec: number | null;
  metadata: Record<string, unknown> | string;
  created_at: Date;
}

export class GeofenceRepository {
  constructor(private readonly knex: Knex) {}

  /** Create a geofence from a GeoJSON polygon boundary. */
  public async create(input: {
    tenantId: string;
    name: string;
    type: 'POLYGON' | 'CIRCLE' | 'CORRIDOR';
    boundaryGeoJson: { type: 'Polygon'; coordinates: number[][][] };
    centerLat?: number;
    centerLng?: number;
    radiusM?: number;
    alertOn?: string[];
    dwellSec?: number;
    metadata?: Record<string, unknown>;
  }): Promise<Geofence> {
    const geoJsonStr = JSON.stringify(input.boundaryGeoJson);
    return withTenantContext(this.knex, input.tenantId, async (trx) => {
      const [row] = await trx
        .withSchema(SCHEMA)
        .from(TABLE)
        .insert({
          tenant_id: trx.raw('?::uuid', [input.tenantId]),
          name: input.name,
          geofence_type: input.type,
          boundary: trx.raw('ST_GeomFromGeoJSON(?)::geography', [geoJsonStr]),
          center:
            input.centerLat !== undefined && input.centerLng !== undefined
              ? trx.raw('?::geography', [`SRID=4326;POINT(${input.centerLng} ${input.centerLat})`])
              : null,
          radius_m: input.radiusM ?? null,
          alert_on: input.alertOn ?? ['ENTER', 'EXIT'],
          dwell_sec: input.dwellSec ?? null,
          metadata: JSON.stringify(input.metadata ?? {}),
        })
        .returning('*');
      return toGeofence(row as GeofenceRow);
    });
  }

  /** List geofences for a tenant. */
  public async list(tenantId: string): Promise<Geofence[]> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = await trx
        .withSchema(SCHEMA)
        .from(TABLE)
        .whereRaw('tenant_id = ?::uuid', [tenantId])
        .orderBy('created_at', 'desc');
      return (rows as GeofenceRow[]).map(toGeofence);
    });
  }

  /** Cursor-paginated list (keyset on `(created_at DESC, id)`). */
  public async listPage(
    tenantId: string,
    limit: number,
    cursor?: { createdAt: string; id: string },
  ): Promise<Page<Geofence>> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      let query = trx.withSchema(SCHEMA).from(TABLE).whereRaw('tenant_id = ?::uuid', [tenantId]);
      if (cursor) {
        query = query.where((q) =>
          q
            .where('created_at', '<', cursor.createdAt)
            .orWhere((q2) =>
              q2.where('created_at', '=', cursor.createdAt).andWhere('id', '<', cursor.id),
            ),
        );
      }
      const rows = (await query
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(limit + 1)) as GeofenceRow[];
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last ? toCursor('created_at', last.created_at.toISOString(), last.id) : null;
      return { data: page.map(toGeofence), nextCursor };
    });
  }

  /** Check which geofences contain a point (PostGIS ST_Covers). */
  public async containsPoint(
    tenantId: string,
    latitude: number,
    longitude: number,
  ): Promise<string[]> {
    const pointWkt = `SRID=4326;POINT(${longitude} ${latitude})`;
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = await trx
        .withSchema(SCHEMA)
        .from(TABLE)
        .select('id')
        .whereRaw('tenant_id = ?::uuid', [tenantId])
        .whereRaw('ST_Covers(boundary, ?::geography)', [pointWkt]);
      return (rows as { id: string }[]).map((r) => String(r.id));
    });
  }

  /** Delete a geofence. */
  public async delete(id: string, tenantId: string): Promise<boolean> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const deleted = await trx
        .withSchema(SCHEMA)
        .from(TABLE)
        .whereRaw('id = ?::uuid', [id])
        .whereRaw('tenant_id = ?::uuid', [tenantId])
        .del();
      return deleted > 0;
    });
  }
}

function toGeofence(row: GeofenceRow): Geofence {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    type: row.geofence_type as Geofence['type'],
    boundaryGeoJson: row.boundary,
    centerLat: null,
    centerLng: null,
    radiusM: row.radius_m,
    alertOn: Array.isArray(row.alert_on) ? row.alert_on : [],
    dwellSec: row.dwell_sec,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
  };
}
