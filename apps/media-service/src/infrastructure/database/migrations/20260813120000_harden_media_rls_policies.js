/**
 * Sprint B — harden RLS policies on the media tables
 * (`media.video_channels`, `media.stream_sessions`) from the permissive
 * `USING (true) WITH CHECK (true)` stub to a real, fail-closed tenant predicate.
 *
 * As with the other schemas, the app connects as the `fleetvision` owner/
 * superuser, so RLS is BYPASSED today; these policies are forward-ready
 * (effective once a non-superuser app role is introduced). The repository-layer
 * `WHERE tenant_id = ?` filter is the enforcing boundary now.
 *
 * @param {import("knex").Knex} knex
 */
const PREDICATE = "tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid";

const TABLES = ['video_channels', 'stream_sessions'];

exports.up = async function up(knex) {
  for (const table of TABLES) {
    await knex.raw(`DROP POLICY IF EXISTS ${table}_tenant_isolation ON media.${table}`);
    await knex.raw(
      `CREATE POLICY ${table}_tenant_isolation ON media.${table} USING (${PREDICATE}) WITH CHECK (${PREDICATE})`,
    );
  }
};

exports.down = async function down(knex) {
  for (const table of TABLES) {
    await knex.raw(`DROP POLICY IF EXISTS ${table}_tenant_isolation ON media.${table}`);
    await knex.raw(
      `CREATE POLICY ${table}_tenant_isolation ON media.${table} USING (true) WITH CHECK (true)`,
    );
  }
};
