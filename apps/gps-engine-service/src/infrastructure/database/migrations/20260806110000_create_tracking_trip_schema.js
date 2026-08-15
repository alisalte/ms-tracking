/**
 * Sprint 8 — Trip Engine schema (07 §5, §9.2; 03 §17.2).
 *
 * Adds the trip/idle/parking boundary-event tables the GPS engine's FSMs write
 * to when they detect transitions. These are projection tables (the event-sourced
 * VehicleTracker aggregate in §13.3 is a later cross-cutting concern); they're
 * the queryable read model for trip history, idle reports, and parking status.
 *
 * Tables (all in the `tracking` schema, created by the Sprint 7 migration):
 *   - tracking.trip_events       — trip start/end boundaries (one row per trip).
 *   - tracking.idle_periods      — idle windows (ign on + stationary).
 *   - tracking.parking_periods   — parking windows (ign off + stationary).
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  // --- tracking.trip_events ---
  await knex.schema.withSchema('tracking').createTable('trip_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('vehicle_id').notNullable();
    t.text('status').notNullable().checkIn(['ACTIVE', 'COMPLETED', 'DISCARDED']);
    t.timestamp('started_at', { useTz: true }).notNullable();
    t.timestamp('ended_at', { useTz: true });
    t.double('start_lat').notNullable();
    t.double('start_lng').notNullable();
    t.double('end_lat');
    t.double('end_lng');
    t.double('distance_km').notNullable().defaultTo(0);
    t.integer('duration_s').notNullable().defaultTo(0);
    t.float('max_speed_kmh').notNullable().defaultTo(0);
    t.integer('stop_count').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    'CREATE INDEX ix_trip_events_tenant_vehicle_started ON tracking.trip_events (tenant_id, vehicle_id, started_at DESC)',
  );
  await knex.raw(
    "CREATE INDEX ix_trip_events_active ON tracking.trip_events (tenant_id, vehicle_id) WHERE status = 'ACTIVE'",
  );

  // --- tracking.idle_periods ---
  await knex.schema.withSchema('tracking').createTable('idle_periods', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('vehicle_id').notNullable();
    t.timestamp('started_at', { useTz: true }).notNullable();
    t.timestamp('ended_at', { useTz: true });
    t.integer('duration_s').notNullable().defaultTo(0);
    t.boolean('alerted').notNullable().defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    'CREATE INDEX ix_idle_periods_tenant_vehicle ON tracking.idle_periods (tenant_id, vehicle_id, started_at DESC)',
  );

  // --- tracking.parking_periods ---
  await knex.schema.withSchema('tracking').createTable('parking_periods', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('vehicle_id').notNullable();
    t.text('status').notNullable().checkIn(['ACTIVE', 'ENDED', 'TAMPER']);
    t.timestamp('started_at', { useTz: true }).notNullable();
    t.timestamp('ended_at', { useTz: true });
    t.integer('duration_s').notNullable().defaultTo(0);
    t.double('lat').notNullable();
    t.double('lng').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    'CREATE INDEX ix_parking_periods_tenant_vehicle ON tracking.parking_periods (tenant_id, vehicle_id, started_at DESC)',
  );

  // --- Row-Level Security (tenant-scoped, MVP permissive) ---
  for (const table of ['trip_events', 'idle_periods', 'parking_periods']) {
    await knex.raw(`ALTER TABLE tracking.${table} ENABLE ROW LEVEL SECURITY`);
    await knex.raw(
      `CREATE POLICY ${table}_tenant_isolation ON tracking.${table} USING (true) WITH CHECK (true)`,
    );
  }
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.schema.withSchema('tracking').dropTableIfExists('parking_periods');
  await knex.schema.withSchema('tracking').dropTableIfExists('idle_periods');
  await knex.schema.withSchema('tracking').dropTableIfExists('trip_events');
  // NOTE: do NOT drop the `tracking` schema — shared with Sprint 7 tables.
}
