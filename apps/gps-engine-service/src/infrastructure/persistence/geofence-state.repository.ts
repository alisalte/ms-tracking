/**
 * Geofence evaluation state repository (GPS Engine — Sprint I §23).
 *
 * Durable per-(tenant, vehicle, geofence) membership FSM state in
 * `tracking.geofence_state`. PostgreSQL is authoritative: a worker restart
 * reloads state from these rows, so ENTER/EXIT/DWELL transitions fire exactly
 * once per real-world crossing, never once per process.
 */
import type { Knex } from '@fleetvision/persistence-knex';

export type GeofenceMembershipState = 'OUTSIDE' | 'CANDIDATE_IN' | 'INSIDE' | 'CANDIDATE_OUT';

export interface GeofenceStateRow {
  readonly tenantId: string;
  readonly vehicleId: string;
  readonly geofenceId: string;
  readonly state: GeofenceMembershipState;
  readonly confirmCount: number;
  readonly enteredAt: Date | null;
  readonly dwellFiredAt: Date | null;
  readonly lastSeenAt: Date | null;
}

export interface GeofenceStatePatch {
  readonly state: GeofenceMembershipState;
  readonly confirmCount: number;
  readonly enteredAt: Date | null;
  readonly dwellFiredAt: Date | null;
  readonly lastSeenAt: Date;
}

export class GeofenceStateRepository {
  constructor(private readonly knex: Knex) {}

  /** Load every state row of one vehicle (single query per position). */
  public async loadForVehicle(
    tenantId: string,
    vehicleId: string,
  ): Promise<Map<string, GeofenceStateRow>> {
    const rows = await this.knex
      .withSchema('tracking')
      .from('geofence_state')
      .select(
        'tenant_id',
        'vehicle_id',
        'geofence_id',
        'state',
        'confirm_count',
        'entered_at',
        'dwell_fired_at',
        'last_seen_at',
      )
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('vehicle_id = ?::uuid', [vehicleId]);
    const out = new Map<string, GeofenceStateRow>();
    for (const r of rows as Array<Record<string, unknown>>) {
      out.set(String(r.geofence_id), {
        tenantId: String(r.tenant_id),
        vehicleId: String(r.vehicle_id),
        geofenceId: String(r.geofence_id),
        state: String(r.state) as GeofenceMembershipState,
        confirmCount: Number(r.confirm_count ?? 0),
        enteredAt: r.entered_at ? new Date(r.entered_at as string) : null,
        dwellFiredAt: r.dwell_fired_at ? new Date(r.dwell_fired_at as string) : null,
        lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at as string) : null,
      });
    }
    return out;
  }

  /** Insert-or-update one state row (idempotent upsert on the composite PK). */
  public async upsert(
    tenantId: string,
    vehicleId: string,
    geofenceId: string,
    patch: GeofenceStatePatch,
  ): Promise<void> {
    await this.knex
      .withSchema('tracking')
      .from('geofence_state')
      .insert({
        tenant_id: this.knex.raw('?::uuid', [tenantId]),
        vehicle_id: this.knex.raw('?::uuid', [vehicleId]),
        geofence_id: this.knex.raw('?::uuid', [geofenceId]),
        state: patch.state,
        confirm_count: patch.confirmCount,
        entered_at: patch.enteredAt,
        dwell_fired_at: patch.dwellFiredAt,
        last_seen_at: patch.lastSeenAt,
        updated_at: this.knex.fn.now(),
      })
      .onConflict(['tenant_id', 'vehicle_id', 'geofence_id'])
      .merge({
        state: patch.state,
        confirm_count: patch.confirmCount,
        entered_at: patch.enteredAt,
        dwell_fired_at: patch.dwellFiredAt,
        last_seen_at: patch.lastSeenAt,
        updated_at: this.knex.fn.now(),
      });
  }

  /** Drop state rows whose geofence disappeared (lazy prune). */
  public async deleteForGeofence(geofenceId: string): Promise<void> {
    await this.knex
      .withSchema('tracking')
      .from('geofence_state')
      .whereRaw('geofence_id = ?::uuid', [geofenceId])
      .del();
  }
}
