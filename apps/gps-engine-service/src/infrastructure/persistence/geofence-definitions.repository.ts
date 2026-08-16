/**
 * Geofence definitions read-side repository (GPS Engine — Sprint I §25/§26).
 *
 * Reads the Map-Engine-owned `tracking.geofences` store (the Map Engine owns
 * CRUD; the GPS Engine owns live evaluation — see the boundary comment in
 * map-engine's GeofenceRepository). Evaluation is SET-BASED PostGIS:
 *
 *   1. Candidate narrowing with the GiST-indexed `&&` operator
 *      (`boundary && ST_Expand(point, buffer)`) — never a JavaScript
 *      distance loop over every fence.
 *   2. Exact evaluation on the candidate set: `ST_Covers` for polygons and
 *      the exact spherical `ST_DWithin(center, point, radius_m)` for circles
 *      (never a JS circle approximation).
 *
 * Correctness note: a geofence CONTAINING the point always intersects the
 * expanded point bbox, so the `&&` prefilter can never miss an ENTER — the
 * buffer only widens the near-miss window used for exit confirmation.
 *
 * Assignment semantics (Sprint I §16): a fence WITH rows in
 * `tracking.geofence_vehicles` applies only to assigned vehicles; a fence
 * with NO assignments applies tenant-wide (legacy Sprint F/G behavior).
 */
import type { Knex } from '@fleetvision/persistence-knex';

export interface GeofenceCandidate {
  readonly id: string;
  readonly name: string;
  readonly type: 'POLYGON' | 'CIRCLE' | 'CORRIDOR';
  readonly radiusM: number | null;
  readonly dwellSec: number | null;
  readonly alertOn: readonly string[];
  readonly contains: boolean;
}

export class GeofenceDefinitionsRepository {
  constructor(private readonly knex: Knex) {}

  /**
   * Set-based candidate query for one position. `candidateBufferDeg` widens
   * the bbox prefilter (default 0.05° ≈ 5 km) so recently-exited fences stay
   * in the candidate set for exit confirmation.
   */
  public async candidatesForPosition(
    tenantId: string,
    vehicleId: string,
    latitude: number,
    longitude: number,
    candidateBufferDeg = 0.05,
  ): Promise<GeofenceCandidate[]> {
    const pointWkt = `SRID=4326;POINT(${longitude} ${latitude})`;
    const envelope = this.knex.raw('ST_Expand(ST_GeomFromText(?, 4326), ?)', [
      pointWkt,
      candidateBufferDeg,
    ]);
    const rows = await this.knex
      .withSchema('tracking')
      .from('geofences as g')
      .select(
        'g.id',
        'g.name',
        'g.geofence_type',
        'g.radius_m',
        'g.dwell_sec',
        'g.alert_on',
        this.knex.raw(
          `CASE WHEN g.geofence_type = 'CIRCLE' AND g.center IS NOT NULL AND g.radius_m IS NOT NULL
             THEN ST_DWithin(g.center, ?::geography, g.radius_m)
             ELSE ST_Covers(g.boundary, ?::geography) END AS contains`,
          [pointWkt, pointWkt],
        ),
      )
      .whereRaw('g.tenant_id = ?::uuid', [tenantId])
      .whereRaw("g.status = 'ACTIVE'")
      .whereRaw(
        `(
           EXISTS (SELECT 1 FROM tracking.geofence_vehicles gv
                   WHERE gv.geofence_id = g.id AND gv.vehicle_id = ?::uuid)
           OR NOT EXISTS (SELECT 1 FROM tracking.geofence_vehicles gv2
                          WHERE gv2.geofence_id = g.id)
         )`,
        [vehicleId],
      )
      .whereRaw('g.boundary && ?', [envelope]);
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ''),
      type: String(r.geofence_type) as GeofenceCandidate['type'],
      radiusM: r.radius_m === null || r.radius_m === undefined ? null : Number(r.radius_m),
      dwellSec: r.dwell_sec === null || r.dwell_sec === undefined ? null : Number(r.dwell_sec),
      alertOn: Array.isArray(r.alert_on) ? (r.alert_on as string[]) : [],
      contains: Boolean(r.contains),
    }));
  }

  /**
   * Exact containment check for ONE geofence id (state-refresh path: fences
   * outside the candidate bbox whose persisted state is not OUTSIDE).
   * Returns null when the fence no longer exists / is not ACTIVE — the
   * evaluator then resets state silently (no EXIT event for a deleted fence).
   */
  public async exactContains(
    tenantId: string,
    geofenceId: string,
    latitude: number,
    longitude: number,
  ): Promise<boolean | null> {
    const pointWkt = `SRID=4326;POINT(${longitude} ${latitude})`;
    const rows = await this.knex
      .withSchema('tracking')
      .from('geofences as g')
      .select(
        this.knex.raw(
          `CASE WHEN g.geofence_type = 'CIRCLE' AND g.center IS NOT NULL AND g.radius_m IS NOT NULL
             THEN ST_DWithin(g.center, ?::geography, g.radius_m)
             ELSE ST_Covers(g.boundary, ?::geography) END AS contains`,
          [pointWkt, pointWkt],
        ),
      )
      .whereRaw('g.tenant_id = ?::uuid', [tenantId])
      .whereRaw('g.id = ?::uuid', [geofenceId])
      .whereRaw("g.status = 'ACTIVE'")
      .first();
    if (!rows) return null;
    return Boolean((rows as Record<string, unknown>).contains);
  }
}
