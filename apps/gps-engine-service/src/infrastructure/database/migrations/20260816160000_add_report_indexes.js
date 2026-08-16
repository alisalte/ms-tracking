/**
 * Sprint J — time-leading indexes for the reporting service's aggregate
 * queries over the GPS-engine projections.
 *
 * The existing composite indexes lead with (tenant_id, vehicle_id, started_at)
 * — perfect for per-vehicle history, but the reporting layer aggregates by
 * tenant + TIME only (all vehicles at once), which plans as sequential scans.
 * These additive, forward-only indexes lead with time:
 *   tracking.trip_events   (tenant_id, started_at DESC)
 *   tracking.idle_periods  (tenant_id, started_at DESC)
 *   tracking.parking_periods (tenant_id, started_at DESC)
 *
 * Verified with EXPLAIN in the reporting integration suite (Bitmap/Index scans).
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS ix_trip_events_tenant_started ON tracking.trip_events (tenant_id, started_at DESC)',
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS ix_idle_periods_tenant_started ON tracking.idle_periods (tenant_id, started_at DESC)',
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS ix_parking_periods_tenant_started ON tracking.parking_periods (tenant_id, started_at DESC)',
  );
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS tracking.ix_trip_events_tenant_started');
  await knex.raw('DROP INDEX IF EXISTS tracking.ix_idle_periods_tenant_started');
  await knex.raw('DROP INDEX IF EXISTS tracking.ix_parking_periods_tenant_started');
}
