/**
 * Sprint 2 — Engine-hours persistence (bug fix: flushed engine-hours windows were
 * only broadcast over WebSocket and then discarded; this table gives them a
 * durable home for historical queries).
 *
 * tracking.engine_hours — one row per flushed ignition-on window (accumulated
 * seconds since the last flush), keyed to (tenant, vehicle, recorded_at).
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.schema.withSchema('tracking').createTable('engine_hours', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('vehicle_id').notNullable();
    // The accumulated engine-on seconds in this flush window.
    t.integer('accumulated_sec').notNullable();
    // When the window was captured (the position's captured_at at flush time).
    t.timestamp('recorded_at', { useTz: true }).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    'CREATE INDEX ix_engine_hours_tenant_vehicle ON tracking.engine_hours (tenant_id, vehicle_id, recorded_at DESC)',
  );

  // Row-Level Security — tenant-aware policy matching the Sprint-1 pattern.
  await knex.raw('ALTER TABLE tracking.engine_hours ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE tracking.engine_hours FORCE ROW LEVEL SECURITY');
  await knex.raw('DROP POLICY IF EXISTS engine_hours_tenant_isolation ON tracking.engine_hours');
  await knex.raw(`
    CREATE POLICY engine_hours_tenant_isolation ON tracking.engine_hours
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  `);
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.raw('DROP POLICY IF EXISTS engine_hours_tenant_isolation ON tracking.engine_hours');
  await knex.schema.withSchema('tracking').dropTableIfExists('engine_hours');
}
