/**
 * Grant tracking runtime privileges to the local non-owner Postgres roles.
 *
 * The tracking schema/tables are created through the privileged
 * `fleetvision_platform` migration connection (migrationsClient →
 * DBURL_PLATFORM), but the runtime service connects as the RLS-enforced
 * `fleetvision_app` role — without explicit grants the service boots,
 * migrates, then fails its first position write with:
 *
 *   permission denied for schema tracking
 *
 * Mirrors identity-service's 20260820100000_grant_iam_runtime_privileges:
 * DML-only on the service's runtime schema, plus sequence usage for
 * identity/serial columns and default privileges so tables added by future
 * platform-role migrations are usable by the app role without a follow-up
 * grant. RLS still governs tenant visibility for `fleetvision_app`;
 * `fleetvision_platform` keeps BYPASSRLS for migrations/platform operations.
 *
 * Runs LAST in the directory so `ON ALL TABLES` covers everything created by
 * the earlier tracking migrations in the same bootstrap.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.raw('GRANT USAGE ON SCHEMA tracking TO fleetvision_app, fleetvision_platform');

  await knex.raw(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tracking TO fleetvision_app, fleetvision_platform',
  );
  await knex.raw(
    'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA tracking TO fleetvision_app, fleetvision_platform',
  );

  await knex.raw(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA tracking GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fleetvision_app, fleetvision_platform',
  );
  await knex.raw(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA tracking GRANT USAGE, SELECT ON SEQUENCES TO fleetvision_app, fleetvision_platform',
  );
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.raw(
    'REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tracking FROM fleetvision_app, fleetvision_platform',
  );
  await knex.raw(
    'REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA tracking FROM fleetvision_app, fleetvision_platform',
  );
  await knex.raw('REVOKE USAGE ON SCHEMA tracking FROM fleetvision_app, fleetvision_platform');
}
