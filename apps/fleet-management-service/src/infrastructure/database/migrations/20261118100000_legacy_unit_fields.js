/**
 * Fields carried over from the legacy tracking system's unit exports.
 *
 *   - fleet.devices.sim_number        — the tracker's SIM (MSISDN), e.g. +989018237131.
 *   - fleet.vehicles.temperature_offset_c — °C added to every cargo / fridge probe
 *     reading of the vehicle (the legacy "شیفت دما"); the temperature report
 *     applies it. NULL = no correction.
 *   - fleet.vehicles.legacy_fields    — the legacy custom fields kept verbatim
 *     ({ "ردیف": "22-1", "نوع ماشين": "اسكانيا تك", … }) plus the legacy groups.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.raw('ALTER TABLE fleet.devices ADD COLUMN IF NOT EXISTS sim_number text');
  await knex.raw(
    'ALTER TABLE fleet.vehicles ADD COLUMN IF NOT EXISTS temperature_offset_c double precision',
  );
  await knex.raw('ALTER TABLE fleet.vehicles ADD COLUMN IF NOT EXISTS legacy_fields jsonb');
}

export async function down(knex) {
  await knex.raw('ALTER TABLE fleet.vehicles DROP COLUMN IF EXISTS legacy_fields');
  await knex.raw('ALTER TABLE fleet.vehicles DROP COLUMN IF EXISTS temperature_offset_c');
  await knex.raw('ALTER TABLE fleet.devices DROP COLUMN IF EXISTS sim_number');
}
