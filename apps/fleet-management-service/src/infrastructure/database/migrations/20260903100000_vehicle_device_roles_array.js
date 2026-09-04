/**
 * A bound device may play several roles on the vehicle at once (tracker +
 * MDVR cameras + sensors on one Meitrack unit). `role` stays as the primary
 * function for older readers; `roles` is the full set.
 *
 * @param {import('knex').Knex} knex
 */

export async function up(knex) {
  await knex.schema.withSchema('fleet').alterTable('vehicle_devices', (t) => {
    t.specificType('roles', 'text[]').notNullable().defaultTo(knex.raw("ARRAY['TRACKER']::text[]"));
  });
  await knex.raw('UPDATE fleet.vehicle_devices SET roles = ARRAY[role]::text[]');
  await knex.raw(`
    ALTER TABLE fleet.vehicle_devices
      ADD CONSTRAINT fleet_vehicle_devices_roles_known
      CHECK (
        cardinality(roles) >= 1
        AND roles <@ ARRAY['TRACKER','MDVR','CAN','SENSOR','OTHER']::text[]
      )
  `);
}

export async function down(knex) {
  await knex.raw(
    'ALTER TABLE fleet.vehicle_devices DROP CONSTRAINT IF EXISTS fleet_vehicle_devices_roles_known',
  );
  await knex.schema.withSchema('fleet').alterTable('vehicle_devices', (t) => {
    t.dropColumn('roles');
  });
}
