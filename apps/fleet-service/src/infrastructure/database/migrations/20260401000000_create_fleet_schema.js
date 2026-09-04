/**
 * Sprint 6 — Driver + Business Trip schema.
 *
 * Creates the `fleet` schema with two tables:
 *   - fleet.drivers       — driver profiles, license, status, vehicle assignment.
 *   - fleet.business_trips — planned/active/completed business trips (a fleet
 *                            management entity, NOT the GPS Engine's trip FSM).
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.raw('CREATE SCHEMA IF NOT EXISTS fleet');

  const hasDrivers = await knex.schema.withSchema('fleet').hasTable('drivers');
  if (hasDrivers) {
    // Already applied under the older `fleet_ops_schema_migrations` ledger.
    return;
  }

  // ── fleet.drivers ──
  await knex.schema.withSchema('fleet').createTable('drivers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.string('employee_id', 64).nullable();
    t.string('first_name', 128).notNullable();
    t.string('last_name', 128).notNullable();
    t.string('email', 256).nullable();
    t.string('phone', 32).nullable();
    // License info
    t.string('license_number', 64).notNullable();
    t.string('license_class', 32).nullable();
    t.date('license_issued').nullable();
    t.date('license_expires').nullable();
    t.string('license_country', 64).nullable();
    // Status: ACTIVE / INACTIVE / SUSPENDED / TERMINATED
    t.text('status')
      .notNullable()
      .checkIn(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'TERMINATED'])
      .defaultTo('ACTIVE');
    // Vehicle assignment (one driver → one vehicle at a time)
    t.uuid('assigned_vehicle_id').nullable();
    t.timestamp('assigned_at', { useTz: true }).nullable();
    // Driver history / metadata
    t.jsonb('metadata').notNullable().defaultTo(JSON.stringify({}));
    t.integer('version').notNullable().defaultTo(1);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw('CREATE INDEX ix_drivers_tenant ON fleet.drivers (tenant_id, created_at DESC)');
  await knex.raw('CREATE INDEX ix_drivers_tenant_status ON fleet.drivers (tenant_id, status)');
  await knex.raw(
    'CREATE INDEX ix_drivers_assigned_vehicle ON fleet.drivers (tenant_id, assigned_vehicle_id) WHERE assigned_vehicle_id IS NOT NULL',
  );

  // ── fleet.business_trips ──
  await knex.schema.withSchema('fleet').createTable('business_trips', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('driver_id').nullable();
    t.uuid('vehicle_id').nullable();
    // Status: PLANNED / ACTIVE / COMPLETED / CANCELLED
    t.text('status')
      .notNullable()
      .checkIn(['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED'])
      .defaultTo('PLANNED');
    // Trip details
    t.string('origin_label', 256).nullable();
    t.double('origin_lat').nullable();
    t.double('origin_lng').nullable();
    t.string('destination_label', 256).nullable();
    t.double('destination_lat').nullable();
    t.double('destination_lng').nullable();
    t.double('distance_km').notNullable().defaultTo(0);
    t.integer('duration_sec').notNullable().defaultTo(0);
    t.string('purpose', 256).nullable();
    t.text('notes').nullable();
    // Timestamps
    t.timestamp('planned_start', { useTz: true }).nullable();
    t.timestamp('planned_end', { useTz: true }).nullable();
    t.timestamp('actual_start', { useTz: true }).nullable();
    t.timestamp('actual_end', { useTz: true }).nullable();
    t.integer('version').notNullable().defaultTo(1);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    'CREATE INDEX ix_btrips_tenant ON fleet.business_trips (tenant_id, created_at DESC)',
  );
  await knex.raw(
    'CREATE INDEX ix_btrips_tenant_status ON fleet.business_trips (tenant_id, status)',
  );
  await knex.raw(
    'CREATE INDEX ix_btrips_tenant_driver ON fleet.business_trips (tenant_id, driver_id, created_at DESC)',
  );
  await knex.raw(
    'CREATE INDEX ix_btrips_tenant_vehicle ON fleet.business_trips (tenant_id, vehicle_id, created_at DESC)',
  );

  // ── RLS (hardened pattern) ──
  for (const table of ['drivers', 'business_trips']) {
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

  // ── Grants ──
  await knex.raw('GRANT USAGE ON SCHEMA fleet TO fleetvision_app, fleetvision_platform');
  await knex.raw(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA fleet TO fleetvision_app, fleetvision_platform',
  );
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  for (const table of ['business_trips', 'drivers']) {
    await knex.raw(`DROP POLICY IF EXISTS "${table}_tenant_isolation" ON fleet."${table}"`);
    await knex.schema.withSchema('fleet').dropTableIfExists(table);
  }
  await knex.raw('DROP SCHEMA IF EXISTS fleet');
}
