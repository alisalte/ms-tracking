/**
 * Analog sensor wiring on the vehicle.
 *
 * A Teltonika analog input only reports a voltage. Which sensor is wired to it
 * (fuel sender, coolant temperature sender…) and how its voltage maps to litres
 * or °C belongs to the machine, so the mapping is stored once on
 * `fleet.vehicles` and the dashboard turns the live voltage into a gauge.
 *
 * Shape (validated by the API, not the database):
 *   [{ input: 'ain1', kind: 'fuel' | 'temperature' | 'voltage', label?, tankLiters?,
 *      points: [{ v: number, value: number }, …] }]
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.raw('ALTER TABLE fleet.vehicles ADD COLUMN IF NOT EXISTS io_sensors jsonb');
}

export async function down(knex) {
  await knex.raw('ALTER TABLE fleet.vehicles DROP COLUMN IF EXISTS io_sensors');
}
