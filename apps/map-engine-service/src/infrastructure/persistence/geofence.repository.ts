/**
 * Geofence repository — `tracking.geofences` CRUD + spatial queries
 * (08 §4; 03 §17.2; Sprint I §5–§11).
 *
 * The Map Engine owns the geometry store + CRUD. The GPS Engine owns live
 * evaluation — its evaluator reads `tracking.geofences` through its own
 * read-side repo (`candidatesForPosition`); this repo remains the write side.
 *
 * Sprint I additions:
 *   - PostGIS-authoritative geometry validation (ST_IsValid + ST_IsValidReason)
 *     before ANY persist — invalid / self-intersecting polygons are a
 *     controlled `GeofenceValidationError`, never a silent repair (§8).
 *   - Full CRUD: findById / update / setStatus / archive (soft delete).
 *   - Cursor pagination + filters (status, type, search, vehicleId) (§11).
 *   - Vehicle ↔ geofence assignments in `tracking.geofence_vehicles` (§16).
 *   - Circle containment uses the EXACT `ST_DWithin(center, point, radius)`
 *     on the geography sphere — not a JavaScript approximation (§7). The
 *     stored `boundary` polygon (a materialized circle ring) remains the
 *     indexed spatial footprint for candidate lookups.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import type { Geofence } from '../../domain/geo-types.js';
import {
  GeofenceValidationError,
  validateAlertOn,
  validateBoundaryGeoJson,
  validateCircleInput,
  validateStatus,
} from '../../domain/geofence-validation.js';

const SCHEMA = 'tracking';
const TABLE = 'geofences';
const ASSIGNS = 'geofence_vehicles';

export interface GeofenceListFilters {
  readonly status?: string;
  readonly type?: string;
  readonly search?: string;
  readonly vehicleId?: string;
  readonly limit: number;
  readonly cursor?: string | null;
}

export interface GeofencePage {
  readonly items: Geofence[];
  readonly nextCursor: string | null;
}

interface GeofenceRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  geofence_type: string;
  boundary_geojson: unknown;
  radius_m: number | null;
  status: string;
  alert_on: string[] | unknown;
  dwell_sec: number | null;
  metadata: Record<string, unknown> | string;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  /** Decoded center coordinates (ST_Y/ST_X projections added by queries). */
  center_lat?: string | number | null;
  center_lng?: string | number | null;
}

export class GeofenceRepository {
  constructor(private readonly knex: Knex) {}

  /**
   * PostGIS-authoritative geometry validation (§6/§8): ST_IsValid on the
   * parsed GeoJSON catches self-intersections and malformed rings before any
   * persist. Throws GeofenceValidationError with the ST_IsValidReason detail.
   */
  public async assertValidGeometry(boundaryGeoJson: {
    type: 'Polygon';
    coordinates: number[][][];
  }): Promise<void> {
    const rows = await this.knex.raw(
      'SELECT ST_IsValid(ST_GeomFromGeoJSON(?)) AS valid, ST_IsValidReason(ST_GeomFromGeoJSON(?)) AS reason',
      [JSON.stringify(boundaryGeoJson), JSON.stringify(boundaryGeoJson)],
    );
    const row = rows?.rows?.[0] as { valid: boolean; reason: string } | undefined;
    if (!row || !row.valid) {
      throw new GeofenceValidationError(
        `Invalid polygon geometry: ${row?.reason ?? 'unknown PostGIS reason'}`,
        'INVALID_GEOMETRY',
        row?.reason,
      );
    }
  }

  /** Validate + create a geofence from a GeoJSON polygon boundary. */
  public async create(input: {
    tenantId: string;
    name: string;
    type: 'POLYGON' | 'CIRCLE' | 'CORRIDOR';
    boundaryGeoJson: { type: 'Polygon'; coordinates: number[][][] };
    description?: string;
    centerLat?: number;
    centerLng?: number;
    radiusM?: number;
    alertOn?: string[];
    dwellSec?: number;
    createdBy?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Geofence> {
    validateBoundaryGeoJson(input.boundaryGeoJson);
    await this.assertValidGeometry(input.boundaryGeoJson);
    if (input.alertOn) validateAlertOn(input.alertOn);
    if (input.type === 'CIRCLE') {
      validateCircleInput({
        latitude: input.centerLat ?? Number.NaN,
        longitude: input.centerLng ?? Number.NaN,
        radiusMeters: input.radiusM ?? Number.NaN,
      });
    }
    const geoJsonStr = JSON.stringify(input.boundaryGeoJson);
    const [row] = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .insert({
        tenant_id: this.knex.raw('?::uuid', [input.tenantId]),
        name: input.name,
        description: input.description ?? null,
        geofence_type: input.type,
        boundary: this.knex.raw('ST_GeomFromGeoJSON(?)::geography', [geoJsonStr]),
        center:
          input.centerLat !== undefined && input.centerLng !== undefined
            ? this.knex.raw('?::geography', [
                `SRID=4326;POINT(${input.centerLng} ${input.centerLat})`,
              ])
            : null,
        radius_m: input.radiusM ?? null,
        status: 'ACTIVE',
        alert_on: input.alertOn ?? ['ENTER', 'EXIT'],
        dwell_sec: input.dwellSec ?? null,
        created_by: input.createdBy ? this.knex.raw('?::uuid', [input.createdBy]) : null,
        metadata: JSON.stringify(input.metadata ?? {}),
      })
      .returning([
        'id',
        'tenant_id',
        'name',
        'description',
        'geofence_type',
        this.knex.raw('ST_AsGeoJSON(boundary) AS boundary_geojson'),
        'radius_m',
        'status',
        'alert_on',
        'dwell_sec',
        'metadata',
        'created_at',
        'updated_at',
        this.knex.raw('ST_Y(center::geometry) AS center_lat'),
        this.knex.raw('ST_X(center::geometry) AS center_lng'),
      ]);
    return toGeofence(row as GeofenceRow, []);
  }

  /** Get one geofence by id (tenant-scoped; null when absent cross-tenant). */
  public async findById(id: string, tenantId: string): Promise<Geofence | null> {
    const rows = await this.selectBase(tenantId).whereRaw('id = ?::uuid', [id]).limit(1);
    if (rows.length === 0) return null;
    const assigns = await this.assignedVehicleIds(tenantId, [id]);
    return toGeofence(rows[0] as GeofenceRow, assigns.get(id) ?? []);
  }

  /** List geofences for a tenant (unpaginated — legacy Sprint F/G shape). */
  public async list(tenantId: string): Promise<Geofence[]> {
    const rows = (await this.selectBase(tenantId).orderBy('created_at', 'desc')) as GeofenceRow[];
    const assigns = await this.assignedVehicleIds(
      tenantId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => toGeofence(r, assigns.get(r.id) ?? []));
  }

  /**
   * Cursor-paginated list with filters (Sprint I §11). Keyset pagination on
   * (created_at DESC, id DESC); the cursor is base64(`${iso}|${id}`).
   * ARCHIVED rows are hidden unless explicitly requested.
   */
  public async listPage(tenantId: string, filters: GeofenceListFilters): Promise<GeofencePage> {
    const limit = Math.min(Math.max(filters.limit, 1), 100);
    const q = this.selectBase(tenantId);
    q.where((builder) => {
      const status = filters.status ?? 'ACTIVE,INACTIVE';
      builder.whereIn(
        'status',
        status
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
    });
    if (filters.type)
      q.whereIn(
        'geofence_type',
        filters.type
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
    if (filters.search) q.whereILike('name', `%${filters.search}%`);
    if (filters.vehicleId) {
      if (!UUID_RE.test(filters.vehicleId)) {
        throw new GeofenceValidationError('vehicleId filter must be a uuid', 'INVALID_GEOJSON');
      }
      q.whereRaw(
        `EXISTS (SELECT 1 FROM ${SCHEMA}.${ASSIGNS} gv WHERE gv.geofence_id = ${SCHEMA}.${TABLE}.id AND gv.vehicle_id = ?::uuid)`,
        [filters.vehicleId],
      );
    }
    if (filters.cursor) {
      const decoded = decodeCursor(filters.cursor);
      if (decoded) {
        q.where((b) =>
          b
            .where('created_at', '<', decoded.createdAt)
            .orWhere((b2) =>
              b2.where('created_at', '=', decoded.createdAt).where('id', '<', decoded.id),
            ),
        );
      }
    }
    q.orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1);
    const rows = (await q) as GeofenceRow[];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const assigns = await this.assignedVehicleIds(
      tenantId,
      page.map((r) => r.id),
    );
    const items = page.map((r) => toGeofence(r, assigns.get(r.id) ?? []));
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(new Date(last.created_at ?? 0), last.id) : null,
    };
  }

  /**
   * Update editable fields (Sprint I §15). Geometry changes re-validate via
   * PostGIS. `version` is bumped + updated_at touched. Returns the updated
   * row or null when absent cross-tenant.
   */
  public async update(
    id: string,
    tenantId: string,
    patch: {
      name?: string;
      description?: string | null;
      boundaryGeoJson?: { type: 'Polygon'; coordinates: number[][][] };
      centerLat?: number;
      centerLng?: number;
      radiusM?: number;
      alertOn?: string[];
      dwellSec?: number | null;
    },
  ): Promise<Geofence | null> {
    if (patch.boundaryGeoJson) {
      validateBoundaryGeoJson(patch.boundaryGeoJson);
      await this.assertValidGeometry(patch.boundaryGeoJson);
    }
    if (patch.alertOn) validateAlertOn(patch.alertOn);
    if (
      patch.radiusM !== undefined ||
      patch.centerLat !== undefined ||
      patch.centerLng !== undefined
    ) {
      // Re-validate circle integrity when any circle-defining field changes.
      const existing = await this.findById(id, tenantId);
      if (existing?.type === 'CIRCLE') {
        validateCircleInput({
          latitude: patch.centerLat ?? existing.centerLat ?? Number.NaN,
          longitude: patch.centerLng ?? existing.centerLng ?? Number.NaN,
          radiusMeters: patch.radiusM ?? existing.radiusM ?? Number.NaN,
        });
      }
    }
    const values: Record<string, unknown> = {
      version: this.knex.raw('version + 1'),
      updated_at: this.knex.fn.now(),
    };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.description !== undefined) values.description = patch.description;
    if (patch.alertOn !== undefined) {
      // Explicit text[] cast — plain JS arrays bind differently in knex's
      // update path than in insert (Sprint I E2E finding).
      values.alert_on = this.knex.raw('?::text[]', [
        `{${patch.alertOn.map((a) => `"${a}"`).join(',')}}`,
      ]);
    }
    if (patch.dwellSec !== undefined) values.dwell_sec = patch.dwellSec;
    if (patch.radiusM !== undefined) values.radius_m = patch.radiusM;
    if (patch.boundaryGeoJson !== undefined) {
      values.boundary = this.knex.raw('ST_GeomFromGeoJSON(?)::geography', [
        JSON.stringify(patch.boundaryGeoJson),
      ]);
    }
    if (patch.centerLat !== undefined && patch.centerLng !== undefined) {
      values.center = this.knex.raw('?::geography', [
        `SRID=4326;POINT(${patch.centerLng} ${patch.centerLat})`,
      ]);
    }
    const rows = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('id = ?::uuid', [id])
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .update(values)
      .returning([
        'id',
        'tenant_id',
        'name',
        'description',
        'geofence_type',
        this.knex.raw('ST_AsGeoJSON(boundary) AS boundary_geojson'),
        'radius_m',
        'status',
        'alert_on',
        'dwell_sec',
        'metadata',
        'created_at',
        'updated_at',
        this.knex.raw('ST_Y(center::geometry) AS center_lat'),
        this.knex.raw('ST_X(center::geometry) AS center_lng'),
      ]);
    if (!rows || rows.length === 0) return null;
    const assigns = await this.assignedVehicleIds(tenantId, [id]);
    return toGeofence(rows[0] as GeofenceRow, assigns.get(id) ?? []);
  }

  /** Set lifecycle status (activate / deactivate / archive). */
  public async setStatus(
    id: string,
    tenantId: string,
    status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED',
  ): Promise<Geofence | null> {
    validateStatus(status);
    const rows = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('id = ?::uuid', [id])
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .update({ status, updated_at: this.knex.fn.now(), version: this.knex.raw('version + 1') })
      .returning([
        'id',
        'tenant_id',
        'name',
        'description',
        'geofence_type',
        this.knex.raw('ST_AsGeoJSON(boundary) AS boundary_geojson'),
        'radius_m',
        'status',
        'alert_on',
        'dwell_sec',
        'metadata',
        'created_at',
        'updated_at',
        this.knex.raw('ST_Y(center::geometry) AS center_lat'),
        this.knex.raw('ST_X(center::geometry) AS center_lng'),
      ]);
    if (!rows || rows.length === 0) return null;
    const assigns = await this.assignedVehicleIds(tenantId, [id]);
    return toGeofence(rows[0] as GeofenceRow, assigns.get(id) ?? []);
  }

  /** Soft delete = archive (Sprint I §10 — historical references stay valid). */
  public async archive(id: string, tenantId: string): Promise<boolean> {
    return (await this.setStatus(id, tenantId, 'ARCHIVED')) !== null;
  }

  /** Hard delete (legacy Sprint F/G behavior, kept for the legacy endpoint). */
  public async delete(id: string, tenantId: string): Promise<boolean> {
    await this.knex.withSchema(SCHEMA).from(ASSIGNS).whereRaw('geofence_id = ?::uuid', [id]).del();
    const deleted = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('id = ?::uuid', [id])
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .del();
    return deleted > 0;
  }

  /**
   * Point containment (Sprint I §7): exact ST_DWithin on the geography sphere
   * for CIRCLE fences, ST_Covers for POLYGON/CORRIDOR. Set-based, one query.
   */
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
      .whereRaw("status = 'ACTIVE'")
      .whereRaw(
        `CASE WHEN geofence_type = 'CIRCLE' AND center IS NOT NULL AND radius_m IS NOT NULL
           THEN ST_DWithin(center, ?::geography, radius_m)
           ELSE ST_Covers(boundary, ?::geography) END`,
        [pointWkt, pointWkt],
      );
    return (rows as { id: string }[]).map((r) => String(r.id));
  }

  // --- Assignments (Sprint I §16) ---

  /** Assign a vehicle to a geofence (idempotent on the composite PK). */
  public async assign(
    tenantId: string,
    geofenceId: string,
    vehicleId: string,
    assignedBy?: string,
  ): Promise<void> {
    await this.knex
      .withSchema(SCHEMA)
      .from(ASSIGNS)
      .insert({
        geofence_id: this.knex.raw('?::uuid', [geofenceId]),
        vehicle_id: this.knex.raw('?::uuid', [vehicleId]),
        tenant_id: this.knex.raw('?::uuid', [tenantId]),
        assigned_by: assignedBy ? this.knex.raw('?::uuid', [assignedBy]) : null,
      })
      .onConflict(['geofence_id', 'vehicle_id'])
      .ignore();
  }

  public async unassign(tenantId: string, geofenceId: string, vehicleId: string): Promise<boolean> {
    const n = await this.knex
      .withSchema(SCHEMA)
      .from(ASSIGNS)
      .whereRaw('geofence_id = ?::uuid', [geofenceId])
      .whereRaw('vehicle_id = ?::uuid', [vehicleId])
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .del();
    return n > 0;
  }

  /** Resolve assigned vehicle ids for a batch of geofence ids (single query). */
  public async assignedVehicleIds(
    tenantId: string,
    geofenceIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (geofenceIds.length === 0) return out;
    const rows = await this.knex
      .withSchema(SCHEMA)
      .from(ASSIGNS)
      .select('geofence_id', 'vehicle_id')
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereIn('geofence_id', geofenceIds);
    for (const r of rows as { geofence_id: string; vehicle_id: string }[]) {
      const list = out.get(r.geofence_id) ?? [];
      list.push(r.vehicle_id);
      out.set(r.geofence_id, list);
    }
    return out;
  }

  /** Replace the full assignment set of a geofence (form semantics). */
  public async replaceAssignments(
    tenantId: string,
    geofenceId: string,
    vehicleIds: readonly string[],
    assignedBy?: string,
  ): Promise<void> {
    await this.knex.transaction(async (trx) => {
      await trx
        .withSchema(SCHEMA)
        .from(ASSIGNS)
        .whereRaw('geofence_id = ?::uuid', [geofenceId])
        .whereRaw('tenant_id = ?::uuid', [tenantId])
        .del();
      for (const vid of vehicleIds) {
        if (!UUID_RE.test(vid)) {
          throw new GeofenceValidationError(`vehicleId ${vid} is not a uuid`, 'INVALID_GEOJSON');
        }
      }
      if (vehicleIds.length > 0) {
        await trx
          .withSchema(SCHEMA)
          .from(ASSIGNS)
          .insert(
            vehicleIds.map((vid) => ({
              geofence_id: trx.raw('?::uuid', [geofenceId]),
              vehicle_id: trx.raw('?::uuid', [vid]),
              tenant_id: trx.raw('?::uuid', [tenantId]),
              assigned_by: assignedBy ? trx.raw('?::uuid', [assignedBy]) : null,
            })),
          )
          .onConflict(['geofence_id', 'vehicle_id'])
          .ignore();
      }
    });
  }

  // --- helpers ---

  private selectBase(tenantId: string): Knex.QueryBuilder {
    return this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .select(
        'id',
        'tenant_id',
        'name',
        'description',
        'geofence_type',
        this.knex.raw('ST_AsGeoJSON(boundary) AS boundary_geojson'),
        'radius_m',
        'status',
        'alert_on',
        'dwell_sec',
        'metadata',
        'created_at',
        'updated_at',
        this.knex.raw('ST_Y(center::geometry) AS center_lat'),
        this.knex.raw('ST_X(center::geometry) AS center_lng'),
      )
      .whereRaw('tenant_id = ?::uuid', [tenantId]);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = raw.lastIndexOf('|');
    if (sep <= 0) return null;
    const createdAt = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    if (Number.isNaN(Date.parse(createdAt)) || !UUID_RE.test(id)) return null;
    return { createdAt: new Date(createdAt).toISOString(), id };
  } catch {
    return null;
  }
}

function toGeofence(row: GeofenceRow, assignedVehicleIds: readonly string[]): Geofence {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description ?? null,
    type: row.geofence_type as Geofence['type'],
    centerLat:
      row.center_lat !== undefined && row.center_lat !== null ? Number(row.center_lat) : null,
    centerLng:
      row.center_lng !== undefined && row.center_lng !== null ? Number(row.center_lng) : null,
    radiusM: row.radius_m,
    status: (row.status ?? 'ACTIVE') as Geofence['status'],
    alertOn: Array.isArray(row.alert_on) ? row.alert_on : [],
    dwellSec: row.dwell_sec,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    boundaryGeoJson:
      typeof row.boundary_geojson === 'string'
        ? (JSON.parse(row.boundary_geojson) as unknown)
        : row.boundary_geojson,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    assignedVehicleIds,
  };
}
