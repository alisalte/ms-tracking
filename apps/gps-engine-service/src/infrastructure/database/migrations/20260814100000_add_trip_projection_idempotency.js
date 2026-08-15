/**
 * Sprint D §6 — projection idempotency for the trip FSM boundary tables.
 *
 * Kafka consumption is at-least-once: a redelivered position re-runs the FSMs
 * and re-emits the same boundary events. `tracking.vehicle_positions`
 * (composite PK) and `tracking.engine_hours` (UNIQUE source_event_id) were
 * already redelivery-safe; `trip_events`, `idle_periods`, and `parking_periods`
 * were NOT — a replayed `trip.started` created a second ACTIVE row.
 *
 * This migration adds `source_event_id` (the triggering position's messageId)
 * + a UNIQUE index to each table. The repositories insert with
 * `ON CONFLICT (source_event_id) DO NOTHING`; NULL source_event_id (legacy
 * events without the stamp) never conflicts — PostgreSQL treats NULLs as
 * distinct in unique indexes.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  for (const table of ['trip_events', 'idle_periods', 'parking_periods']) {
    await knex.schema.withSchema('tracking').alterTable(table, (t) => {
      t.uuid('source_event_id').nullable().defaultTo(null);
    });
    // B-tree unique index (not a constraint) to coexist with the RLS-hardened
    // tables (20260813120000) — same pattern as ux_engine_hours_source_event.
    await knex.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_${table}_source_event ON tracking.${table} (source_event_id)`,
    );
  }
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  for (const table of ['trip_events', 'idle_periods', 'parking_periods']) {
    await knex.raw(`DROP INDEX IF EXISTS tracking.ux_${table}_source_event`);
    await knex.schema.withSchema('tracking').alterTable(table, (t) => {
      t.dropColumn('source_event_id');
    });
  }
}
