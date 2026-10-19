/**
 * Two-shift haul routes.
 *
 * `shift_count` splits the work day into back-to-back shifts of
 * `shift_duration_hours` (two 12 h shifts by default). `shift_drivers` on a
 * truck member is the per-shift roster: element `n - 1` is the driver of
 * shift `n`, so the same truck credits a different driver in each shift.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.raw(`
    ALTER TABLE fleet.haul_routes
      ADD COLUMN IF NOT EXISTS shift_count integer NOT NULL DEFAULT 2
  `);
  await knex.raw(`
    UPDATE fleet.haul_routes
       SET shift_count = GREATEST(1, LEAST(4, 24 / GREATEST(1, shift_duration_hours)))
  `);
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
    ALTER TABLE fleet.haul_members
      ADD COLUMN IF NOT EXISTS shift_drivers uuid[] NOT NULL DEFAULT '{}'
  `);
}

export async function down(knex) {
  await knex.raw('ALTER TABLE fleet.haul_members DROP COLUMN IF EXISTS shift_drivers');
  await knex.raw(
    'ALTER TABLE fleet.haul_routes DROP CONSTRAINT IF EXISTS fleet_haul_routes_shift_check',
  );
  await knex.raw('ALTER TABLE fleet.haul_routes DROP COLUMN IF EXISTS shift_count');
}
