/**
 * Registry odometer — the operator-entered current counter (km) on the vehicle
 * card. Distinct from GPS-derived `tracking.vehicle_positions.odometer_km`.
 * Nullable so existing vehicles and Excel rows without a reading stay valid.
 *
 * @param {import("knex").Knex} knex
 */

export async function up(knex) {
  await knex.schema.withSchema('fleet').alterTable('vehicles', (t) => {
    t.double('odometer_km').nullable();
  });
  await knex.raw(`
    ALTER TABLE fleet.vehicles
      ADD CONSTRAINT fleet_vehicles_odometer_km_nonnegative
      CHECK (odometer_km IS NULL OR odometer_km >= 0)
  `);
}

export async function down(knex) {
  await knex.raw(
    'ALTER TABLE fleet.vehicles DROP CONSTRAINT IF EXISTS fleet_vehicles_odometer_km_nonnegative',
  );
  await knex.schema.withSchema('fleet').alterTable('vehicles', (t) => {
    t.dropColumn('odometer_km');
  });
}
