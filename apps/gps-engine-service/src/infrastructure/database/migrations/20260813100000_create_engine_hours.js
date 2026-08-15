/**
 * Sprint A — Engine-hours persistence (07 §5.6; 03 §11).
 *
 * The engine-hours meter accumulates engine-on time and flushes a window on each
 * ignition-off edge. Previously the flushed value was emitted to the signal bus
 * but never durably persisted (engineHoursFlushed was discarded). This migration
 * adds the durable sink: `tracking.engine_hours`, one row per flushed ignition-on
 * window.
 *
 * Idempotency: `source_event_id` (the messageId of the position that triggered
 * the flush) is globally unique and UNIQUE-constrained, so Kafka redelivery
 * inserts nothing on the second pass (the repository uses ON CONFLICT DO
 * NOTHING).
 *
 * Convention note: UUID/timestamp/RLS patterns mirror the Sprint 8 trip schema
 * migration (`20260806110000_create_tracking_trip_schema.js`). The `tracking`
 * schema itself is created by the Sprint 7 position migration.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.schema.withSchema('tracking').createTable('engine_hours', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('vehicle_id').notNullable();
    t.timestamp('window_start', { useTz: true }).notNullable();
    t.timestamp('window_end', { useTz: true }).notNullable();
    t.integer('duration_s').notNullable();
    // Decimal hours (duration_s / 3600). decimal(10,4) is exact (no float drift);
    // equivalent to numeric(10,4) in PostgreSQL.
    t.decimal('engine_hours', 10, 4).notNullable();
    // messageId of the flush-trigger position — the idempotency key.
    t.uuid('source_event_id').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Idempotency key: one engine-hours window per flush-trigger event.
  await knex.raw(
    'CREATE UNIQUE INDEX ux_engine_hours_source_event ON tracking.engine_hours (source_event_id)',
  );
  // Hot-path: per-vehicle engine-hours history (newest first).
  await knex.raw(
    'CREATE INDEX ix_engine_hours_tenant_vehicle_window ON tracking.engine_hours (tenant_id, vehicle_id, window_end DESC)',
  );

  // --- Row-Level Security (tenant-scoped, MVP permissive — matches siblings) ---
  await knex.raw('ALTER TABLE tracking.engine_hours ENABLE ROW LEVEL SECURITY');
  await knex.raw(
    'CREATE POLICY engine_hours_tenant_isolation ON tracking.engine_hours USING (true) WITH CHECK (true)',
  );
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.raw('DROP POLICY IF EXISTS engine_hours_tenant_isolation ON tracking.engine_hours');
  await knex.schema.withSchema('tracking').dropTableIfExists('engine_hours');
}
