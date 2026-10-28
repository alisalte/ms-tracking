/**
 * Planned stops of a haul route: lunch and shift handover.
 *
 * `lunch_start_minute` / `lunch_end_minute` are minutes past local midnight
 * (both null = no lunch break). `handover_window_minutes` is how far either
 * side of a shift boundary an engine-off stop still counts as the shift
 * handover (0 = off). Stops inside these windows are reported apart from the
 * stops of the machine itself.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.raw(`
    ALTER TABLE fleet.haul_routes
      ADD COLUMN IF NOT EXISTS lunch_start_minute integer,
      ADD COLUMN IF NOT EXISTS lunch_end_minute integer,
      ADD COLUMN IF NOT EXISTS handover_window_minutes integer NOT NULL DEFAULT 30
  `);
  await knex.raw(`
    ALTER TABLE fleet.haul_routes
      ADD CONSTRAINT fleet_haul_routes_break_check
      CHECK (
        (
          (lunch_start_minute IS NULL AND lunch_end_minute IS NULL)
          OR (
            lunch_start_minute BETWEEN 0 AND 1439
            AND lunch_end_minute BETWEEN 0 AND 1439
            AND lunch_start_minute <> lunch_end_minute
          )
        )
        AND handover_window_minutes BETWEEN 0 AND 120
      )
  `);
}

export async function down(knex) {
  await knex.raw(
    'ALTER TABLE fleet.haul_routes DROP CONSTRAINT IF EXISTS fleet_haul_routes_break_check',
  );
  await knex.raw(`
    ALTER TABLE fleet.haul_routes
      DROP COLUMN IF EXISTS handover_window_minutes,
      DROP COLUMN IF EXISTS lunch_end_minute,
      DROP COLUMN IF EXISTS lunch_start_minute
  `);
}
