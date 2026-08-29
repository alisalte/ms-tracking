/**
 * Registry engine-hours — the operator-entered hour-meter on the vehicle card.
 * Heavy equipment (excavators, loaders, gensets) tracks usage in hours, not km.
 * Nullable so light vehicles and Excel rows without a reading stay valid.
 *
 * @param {import("knex").Knex} knex
 */

export async function up(knex) {
  await knex.schema.withSchema('fleet').alterTable('vehicles', (t) => {
    t.double('engine_hours').nullable();
  });
  await knex.raw(`
    ALTER TABLE fleet.vehicles
      ADD CONSTRAINT fleet_vehicles_engine_hours_nonnegative
      CHECK (engine_hours IS NULL OR engine_hours >= 0)
  `);
}

export async function down(knex) {
  await knex.raw(
    'ALTER TABLE fleet.vehicles DROP CONSTRAINT IF EXISTS fleet_vehicles_engine_hours_nonnegative',
  );
  await knex.schema.withSchema('fleet').alterTable('vehicles', (t) => {
    t.dropColumn('engine_hours');
  });
}
