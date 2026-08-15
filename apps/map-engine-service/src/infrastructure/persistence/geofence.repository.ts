/**
 * Geofence repository — `tracking.geofences` CRUD + spatial queries
 * (08 §4; 03 §17.2).
 *
 * The Map Engine owns the geometry store + CRUD. The GPS Engine owns live
 * evaluation — this repo provides the `containsPoint()` query the GPS Engine's
 * geofence FSM calls (PostGIS `ST_Covers`).
 */
import type { Knex } from '@fleetvision/persistence-knex';
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
  /** Decoded center coordinates (ST_Y/ST_X projections added by queries). */
  center_lat?: string | number | null;
  center_lng?: string | number | null;
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
    const [row] = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .insert({
        tenant_id: this.knex.raw('?::uuid', [input.tenantId]),
        name: input.name,
        geofence_type: input.type,
        boundary: this.knex.raw('ST_GeomFromGeoJSON(?)::geography', [geoJsonStr]),
        center:
          input.centerLat !== undefined && input.centerLng !== undefined
            ? this.knex.raw('?::geography', [
                `SRID=4326;POINT(${input.centerLng} ${input.centerLat})`,
              ])
            : null,
        radius_m: input.radiusM ?? null,
        alert_on: input.alertOn ?? ['ENTER', 'EXIT'],
        dwell_sec: input.dwellSec ?? null,
        metadata: JSON.stringify(input.metadata ?? {}),
      })
      .returning([
        'id',
        'tenant_id',
        'name',
        'geofence_type',
        'boundary',
        'radius_m',
        'alert_on',
        'dwell_sec',
        'metadata',
        this.knex.raw('ST_Y(center::geometry) AS center_lat'),
        this.knex.raw('ST_X(center::geometry) AS center_lng'),
      ]);
    return toGeofence(row as GeofenceRow);
  }

  /** List geofences for a tenant. */
  public async list(tenantId: string): Promise<Geofence[]> {
    const rows = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .select(
        'id',
        'tenant_id',
        'name',
        'geofence_type',
        'boundary',
        'radius_m',
        'alert_on',
        'dwell_sec',
        'metadata',
        this.knex.raw('ST_Y(center::geometry) AS center_lat'),
        this.knex.raw('ST_X(center::geometry) AS center_lng'),
      )
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .orderBy('created_at', 'desc');
    return (rows as GeofenceRow[]).map(toGeofence);
  }

  /** Check which geofences contain a point (PostGIS ST_Covers). */
  public async containsPoint(
    tenantId: string,
    latitude: number,
    longitude: number,
  ): Promise<string[]> {
    const pointWkt = `SRID=4326;POINT(${longitude} ${latitude})`;
    const rows = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .select('id')
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('ST_Covers(boundary, ?::geography)', [pointWkt]);
    return (rows as { id: string }[]).map((r) => String(r.id));
  }

  /** Delete a geofence. */
  public async delete(id: string, tenantId: string): Promise<boolean> {
    const deleted = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('id = ?::uuid', [id])
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .del();
    return deleted > 0;
  }
}

function toGeofence(row: GeofenceRow): Geofence {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    type: row.geofence_type as Geofence['type'],
    boundaryGeoJson: row.boundary,
    // Real center decoded from the geography column (Sprint F — was null).
    centerLat:
      row.center_lat !== undefined && row.center_lat !== null ? Number(row.center_lat) : null,
    centerLng:
      row.center_lng !== undefined && row.center_lng !== null ? Number(row.center_lng) : null,
    radiusM: row.radius_m,
    alertOn: Array.isArray(row.alert_on) ? row.alert_on : [],
    dwellSec: row.dwell_sec,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
  };
}
