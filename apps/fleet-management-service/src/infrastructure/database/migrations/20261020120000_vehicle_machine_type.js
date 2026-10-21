/**
 * Machine type on the vehicle definition.
 *
 * Mine operations used to ask for the machine type (truck / shovel) again for
 * every device on every haul route. The type belongs to the machine, so it is
 * stored once on `fleet.vehicles` and haul routes read it from there.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.raw('ALTER TABLE fleet.vehicles ADD COLUMN IF NOT EXISTS machine_type text');
  await knex.raw(`
    ALTER TABLE fleet.vehicles
      ADD CONSTRAINT fleet_vehicles_machine_type_known
      CHECK (machine_type IS NULL OR machine_type IN ('TRUCK', 'SHOVEL'))
  `);
  // Machines already placed on a haul route keep the type they were given there.
  await knex.raw(`
    UPDATE fleet.vehicles v
       SET machine_type = src.role
      FROM (
        SELECT vd.vehicle_id, MIN(m.role) AS role
          FROM fleet.haul_members m
          JOIN fleet.vehicle_devices vd ON vd.device_id = m.device_id
         GROUP BY vd.vehicle_id
        HAVING COUNT(DISTINCT m.role) = 1
      ) src
     WHERE v.id = src.vehicle_id AND v.machine_type IS NULL
  `);
}

export async function down(knex) {
  await knex.raw(
    'ALTER TABLE fleet.vehicles DROP CONSTRAINT IF EXISTS fleet_vehicles_machine_type_known',
  );
  await knex.raw('ALTER TABLE fleet.vehicles DROP COLUMN IF EXISTS machine_type');
}
