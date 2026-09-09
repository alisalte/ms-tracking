/**
 * Phase 1 / Q0 — durable driver↔vehicle assignment history.
 *
 * Keeps `fleet.drivers.assigned_*` as the denormalized current pointer;
 * intervals live here (`ended_at` null = current).
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  const exists = await knex.schema.withSchema('fleet').hasTable('driver_assignments');
  if (exists) return;

  await knex.schema.withSchema('fleet').createTable('driver_assignments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.uuid('driver_id').notNullable();
    t.uuid('vehicle_id').notNullable();
    t.timestamp('started_at', { useTz: true }).notNullable();
    t.timestamp('ended_at', { useTz: true }).nullable();
    t.uuid('changed_by').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(
    'CREATE INDEX ix_driver_assignments_driver ON fleet.driver_assignments (tenant_id, driver_id, started_at DESC)',
  );
  await knex.raw(
    'CREATE INDEX ix_driver_assignments_vehicle ON fleet.driver_assignments (tenant_id, vehicle_id, started_at DESC)',
  );
  await knex.raw(`
    CREATE UNIQUE INDEX ux_driver_assignments_open_driver
      ON fleet.driver_assignments (tenant_id, driver_id)
      WHERE ended_at IS NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX ux_driver_assignments_open_vehicle
      ON fleet.driver_assignments (tenant_id, vehicle_id)
      WHERE ended_at IS NULL
  `);

  await knex.raw(`ALTER TABLE fleet.driver_assignments ENABLE ROW LEVEL SECURITY`);
  await knex.raw(`ALTER TABLE fleet.driver_assignments FORCE ROW LEVEL SECURITY`);
  await knex.raw(`DROP POLICY IF EXISTS "driver_assignments_tenant_isolation" ON fleet.driver_assignments`);
  await knex.raw(`
    CREATE POLICY "driver_assignments_tenant_isolation" ON fleet.driver_assignments
      USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR COALESCE(current_setting('app.is_platform', true)::boolean, false)
      )
      WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR COALESCE(current_setting('app.is_platform', true)::boolean, false)
      )
  `);

  await knex.raw(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON fleet.driver_assignments TO fleetvision_app, fleetvision_platform',
  );

  // Backfill open intervals from current denormalized pointer.
  await knex.raw(`
    INSERT INTO fleet.driver_assignments
      (id, tenant_id, driver_id, vehicle_id, started_at, ended_at, changed_by)
    SELECT gen_random_uuid(), d.tenant_id, d.id, d.assigned_vehicle_id,
           COALESCE(d.assigned_at, d.created_at), NULL, NULL
    FROM fleet.drivers d
    WHERE d.assigned_vehicle_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM fleet.driver_assignments a
        WHERE a.tenant_id = d.tenant_id
          AND a.driver_id = d.id
          AND a.ended_at IS NULL
      )
  `);
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.raw(`DROP POLICY IF EXISTS "driver_assignments_tenant_isolation" ON fleet.driver_assignments`);
  await knex.schema.withSchema('fleet').dropTableIfExists('driver_assignments');
}
