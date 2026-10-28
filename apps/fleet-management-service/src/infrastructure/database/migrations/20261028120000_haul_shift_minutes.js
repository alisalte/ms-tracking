/**
 * Minute precision for haul route shifts.
 *
 * `shift_start_minute` is the minute past `shift_start_hour` that shift 1
 * starts at, and `shift_duration_minutes` the minutes added to
 * `shift_duration_hours` (06:30 start, 8 h 15 min shifts). Both default to 0,
 * so existing routes keep the schedule they have today.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.raw(`
    ALTER TABLE fleet.haul_routes
      ADD COLUMN IF NOT EXISTS shift_start_minute integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS shift_duration_minutes integer NOT NULL DEFAULT 0
  `);
  await knex.raw(
    'ALTER TABLE fleet.haul_routes DROP CONSTRAINT IF EXISTS fleet_haul_routes_shift_check',
  );
  await knex.raw(`
    ALTER TABLE fleet.haul_routes
      ADD CONSTRAINT fleet_haul_routes_shift_check
      CHECK (
        shift_start_hour BETWEEN 0 AND 23
        AND shift_start_minute BETWEEN 0 AND 59
        AND shift_duration_hours BETWEEN 0 AND 24
        AND shift_duration_minutes BETWEEN 0 AND 59
        AND shift_duration_hours * 60 + shift_duration_minutes BETWEEN 1 AND 1440
        AND shift_count BETWEEN 1 AND 4
        AND shift_count * (shift_duration_hours * 60 + shift_duration_minutes) <= 1440
      )
  `);
}

export async function down(knex) {
  await knex.raw(
    'ALTER TABLE fleet.haul_routes DROP CONSTRAINT IF EXISTS fleet_haul_routes_shift_check',
  );
  await knex.raw(`
    ALTER TABLE fleet.haul_routes
      ADD CONSTRAINT fleet_haul_routes_shift_check
      CHECK (
        shift_start_hour BETWEEN 0 AND 23
        AND shift_duration_hours BETWEEN 1 AND 24
        AND shift_count BETWEEN 1 AND 4
        AND shift_count * shift_duration_hours <= 24
      )
  `);
  await knex.raw(`
    ALTER TABLE fleet.haul_routes
      DROP COLUMN IF EXISTS shift_duration_minutes,
      DROP COLUMN IF EXISTS shift_start_minute
  `);
}
