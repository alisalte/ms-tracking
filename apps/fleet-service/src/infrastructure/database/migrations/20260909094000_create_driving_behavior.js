/**
 * Phase 1 / Driver Behavior Sprint 1 — driving events + daily/period scores.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  const hasEvents = await knex.schema.withSchema('fleet').hasTable('driving_events');
  if (!hasEvents) {
    await knex.schema.withSchema('fleet').createTable('driving_events', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('driver_id').nullable();
      t.uuid('vehicle_id').notNullable();
      t.text('type')
        .notNullable()
        .checkIn(['HARSH_BRAKE', 'RAPID_ACCELERATION', 'SPEED_VIOLATION', 'EXCESSIVE_IDLE']);
      t.text('severity').notNullable().defaultTo('WARNING');
      t.uuid('source_alarm_id').nullable();
      t.timestamp('raised_at', { useTz: true }).notNullable();
      t.jsonb('payload').notNullable().defaultTo(JSON.stringify({}));
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    await knex.raw(
      'CREATE INDEX ix_driving_events_driver ON fleet.driving_events (tenant_id, driver_id, raised_at DESC)',
    );
    await knex.raw(
      'CREATE INDEX ix_driving_events_vehicle ON fleet.driving_events (tenant_id, vehicle_id, raised_at DESC)',
    );
    await knex.raw(`
      CREATE UNIQUE INDEX ux_driving_events_source_alarm
        ON fleet.driving_events (tenant_id, source_alarm_id)
        WHERE source_alarm_id IS NOT NULL
    `);
  }

  const hasScores = await knex.schema.withSchema('fleet').hasTable('driver_scores');
  if (!hasScores) {
    await knex.schema.withSchema('fleet').createTable('driver_scores', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('driver_id').notNullable();
      t.timestamp('period_start', { useTz: true }).notNullable();
      t.timestamp('period_end', { useTz: true }).notNullable();
      t.double('score').notNullable();
      t.integer('harsh_brake_count').notNullable().defaultTo(0);
      t.integer('rapid_accel_count').notNullable().defaultTo(0);
      t.integer('speed_violation_count').notNullable().defaultTo(0);
      t.integer('excessive_idle_count').notNullable().defaultTo(0);
      t.integer('unattributed_skipped').notNullable().defaultTo(0);
      t.timestamp('calculated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    await knex.raw(`
      CREATE UNIQUE INDEX ux_driver_scores_period
        ON fleet.driver_scores (tenant_id, driver_id, period_start, period_end)
    `);
    await knex.raw(
      'CREATE INDEX ix_driver_scores_driver ON fleet.driver_scores (tenant_id, driver_id, calculated_at DESC)',
    );
  }

  for (const table of ['driving_events', 'driver_scores']) {
    await knex.raw(`ALTER TABLE fleet."${table}" ENABLE ROW LEVEL SECURITY`);
    await knex.raw(`ALTER TABLE fleet."${table}" FORCE ROW LEVEL SECURITY`);
    await knex.raw(`DROP POLICY IF EXISTS "${table}_tenant_isolation" ON fleet."${table}"`);
    await knex.raw(`
      CREATE POLICY "${table}_tenant_isolation" ON fleet."${table}"
        USING (
          tenant_id = current_setting('app.current_tenant_id', true)::uuid
          OR COALESCE(current_setting('app.is_platform', true)::boolean, false)
        )
        WITH CHECK (
          tenant_id = current_setting('app.current_tenant_id', true)::uuid
          OR COALESCE(current_setting('app.is_platform', true)::boolean, false)
        )
    `);
  }

  await knex.raw(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON fleet.driving_events, fleet.driver_scores TO fleetvision_app, fleetvision_platform',
  );
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  for (const table of ['driver_scores', 'driving_events']) {
    await knex.raw(`DROP POLICY IF EXISTS "${table}_tenant_isolation" ON fleet."${table}"`);
    await knex.schema.withSchema('fleet').dropTableIfExists(table);
  }
}
