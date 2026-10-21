/**
 * Several drivers per vehicle, one per shift.
 *
 * A machine on a two- or three-shift operation is driven by a different driver
 * in each shift. `shift_no` (1-based, same numbering as the haul route's
 * shifts) says which shift an assignment covers; NULL keeps the old meaning of
 * "the driver of this vehicle, any shift". A vehicle can have one open
 * assignment per shift instead of one in total.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.raw('ALTER TABLE fleet.drivers ADD COLUMN IF NOT EXISTS assigned_shift smallint');
  await knex.raw('ALTER TABLE fleet.driver_assignments ADD COLUMN IF NOT EXISTS shift_no smallint');
  await knex.raw(`
    ALTER TABLE fleet.drivers
      ADD CONSTRAINT fleet_drivers_assigned_shift_range
      CHECK (assigned_shift IS NULL OR assigned_shift BETWEEN 1 AND 4)
  `);
  await knex.raw(`
    ALTER TABLE fleet.driver_assignments
      ADD CONSTRAINT fleet_driver_assignments_shift_range
      CHECK (shift_no IS NULL OR shift_no BETWEEN 1 AND 4)
  `);
  await knex.raw('DROP INDEX IF EXISTS fleet.ux_driver_assignments_open_vehicle');
  await knex.raw(`
    CREATE UNIQUE INDEX ux_driver_assignments_open_vehicle_shift
      ON fleet.driver_assignments (tenant_id, vehicle_id, COALESCE(shift_no, 0))
      WHERE ended_at IS NULL
  `);
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS fleet.ux_driver_assignments_open_vehicle_shift');
  await knex.raw(`
    CREATE UNIQUE INDEX ux_driver_assignments_open_vehicle
      ON fleet.driver_assignments (tenant_id, vehicle_id)
      WHERE ended_at IS NULL
  `);
  await knex.raw(
    'ALTER TABLE fleet.driver_assignments DROP CONSTRAINT IF EXISTS fleet_driver_assignments_shift_range',
  );
  await knex.raw(
    'ALTER TABLE fleet.drivers DROP CONSTRAINT IF EXISTS fleet_drivers_assigned_shift_range',
  );
  await knex.raw('ALTER TABLE fleet.driver_assignments DROP COLUMN IF EXISTS shift_no');
  await knex.raw('ALTER TABLE fleet.drivers DROP COLUMN IF EXISTS assigned_shift');
}
