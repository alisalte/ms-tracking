/**
 * Sprint F §16 — spatial index for the positions hypertable.
 *
 * `tracking.vehicle_positions.geom` is a geography(Point,4326) column populated
 * by every insert, but it had no spatial index: the new nearby (ST_DWithin) and
 * in-bounds (&&) queries would degenerate into full scans. A GIST index on a
 * hypertable propagates to all chunks (existing and future), so compressed
 * chunks are still served via decompression.
 *
 * Deliberately the ONLY new index: the existing
 * ix_positions_tenant_vehicle_time (tenant_id, vehicle_id, captured_at DESC)
 * already covers the latest/history paths — no redundant duplicates.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS ix_positions_geom_gist ON tracking.vehicle_positions USING GIST (geom)',
  );
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS tracking.ix_positions_geom_gist');
}
