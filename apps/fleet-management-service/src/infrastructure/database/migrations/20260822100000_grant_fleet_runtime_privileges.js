/**
 * Grant fleet runtime privileges to the local non-owner Postgres roles.
 *
 * The fleet schema/tables are created through the privileged
 * `fleetvision_platform` migration connection (migrationsClient →
 * DBURL_PLATFORM), but the runtime service connects as the RLS-enforced
 * `fleetvision_app` role — without explicit grants the service boots,
 * migrates, then fails its first registry write with:
 *
 *   permission denied for schema fleet
 *
 * Mirrors identity-service's 20260820100000_grant_iam_runtime_privileges:
 * DML-only on the service's runtime schema, plus sequence usage for
 * identity/serial columns and default privileges so tables added by future
 * platform-role migrations are usable by the app role without a follow-up
 * grant. RLS still governs tenant visibility for `fleetvision_app`;
 * `fleetvision_platform` keeps BYPASSRLS for migrations/platform operations.
 *
 * Runs LAST in the directory so `ON ALL TABLES` covers everything created by
 * the earlier fleet migrations in the same bootstrap.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.raw('GRANT USAGE ON SCHEMA fleet TO fleetvision_app, fleetvision_platform');

  await knex.raw(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA fleet TO fleetvision_app, fleetvision_platform',
  );
  await knex.raw(
    'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA fleet TO fleetvision_app, fleetvision_platform',
  );

  await knex.raw(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA fleet GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fleetvision_app, fleetvision_platform',
  );
  await knex.raw(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA fleet GRANT USAGE, SELECT ON SEQUENCES TO fleetvision_app, fleetvision_platform',
  );
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.raw(
    'REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA fleet FROM fleetvision_app, fleetvision_platform',
  );
  await knex.raw(
    'REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA fleet FROM fleetvision_app, fleetvision_platform',
  );
  await knex.raw('REVOKE USAGE ON SCHEMA fleet FROM fleetvision_app, fleetvision_platform');
}
