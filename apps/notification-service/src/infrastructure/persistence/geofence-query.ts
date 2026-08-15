/**
 * Geofence query helper — runs a PostGIS ST_Covers spatial query against the
 * shared `tracking.geofences` table (owned by map-engine) to find which
 * geofences contain a given point. This is how the Alarm Engine detects
 * geofence enter/exit transitions without a gps-engine geofence FSM.
 *
 * Uses the app-role (RLS-enforced) client so only the tenant's geofences are
 * visible.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import { withTenantContext } from '@fleetvision/persistence-knex';

export class GeofenceQuery {
  constructor(private readonly knex: Knex) {}

  /** Return the IDs of geofences that contain the given lat/lng point. */
  public async containsPoint(
    tenantId: string,
    latitude: number,
    longitude: number,
  ): Promise<string[]> {
    const pointWkt = `SRID=4326;POINT(${longitude} ${latitude})`;
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = (await trx.raw(
        `SELECT id FROM tracking.geofences
         WHERE tenant_id = ?::uuid
           AND ST_Covers(boundary, ?::geography)`,
        [tenantId, pointWkt],
      )) as { rows: { id: string }[] };
      return rows.rows.map((r) => r.id);
    });
  }

  /** Load the dwell_sec for geofences that support dwell alarms. */
  public async getDwellSeconds(tenantId: string, geofenceId: string): Promise<number | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = (await trx.raw(
        'SELECT dwell_sec FROM tracking.geofences WHERE tenant_id = ?::uuid AND id = ?::uuid',
        [tenantId, geofenceId],
      )) as { rows: { dwell_sec: number | null }[] };
      return row.rows[0]?.dwell_sec ?? null;
    });
  }
}
