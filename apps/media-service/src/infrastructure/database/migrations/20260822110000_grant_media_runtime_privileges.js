/**
 * Grant media runtime privileges to the local non-owner Postgres roles.
 *
 * The media schema/tables are created through the privileged
 * `fleetvision_platform` migration connection (migrationsClient →
 * DBURL_PLATFORM), but the runtime service connects as the RLS-enforced
 * `fleetvision_app` role — without explicit grants the service boots,
 * migrates, then fails its first channel read/write with:
 *
 *   permission denied for schema media
 *
 * Mirrors fleet-management's 20260822100000_grant_fleet_runtime_privileges.
 * Runs LAST in the directory so `ON ALL TABLES` covers everything created by
 * the earlier media migrations in the same bootstrap.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.raw('GRANT USAGE ON SCHEMA media TO fleetvision_app, fleetvision_platform');

  await knex.raw(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA media TO fleetvision_app, fleetvision_platform',
  );
  await knex.raw(
    'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA media TO fleetvision_app, fleetvision_platform',
  );

  await knex.raw(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA media GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fleetvision_app, fleetvision_platform',
  );
  await knex.raw(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA media GRANT USAGE, SELECT ON SEQUENCES TO fleetvision_app, fleetvision_platform',
  );
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.raw(
    'REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA media FROM fleetvision_app, fleetvision_platform',
  );
  await knex.raw(
    'REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA media FROM fleetvision_app, fleetvision_platform',
  );
  await knex.raw('REVOKE USAGE ON SCHEMA media FROM fleetvision_app, fleetvision_platform');
}
