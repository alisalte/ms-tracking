/**
 * Grant IAM/audit runtime privileges to the local non-owner Postgres roles.
 *
 * Earlier IAM migrations created schemas/tables through the privileged
 * `fleetvision_platform` connection, but did not grant `fleetvision_app` schema
 * usage/table DML. On fresh Docker stacks the identity service can therefore
 * boot, run migrations, then fail the bootstrap seed with:
 *
 *   permission denied for schema iam
 *
 * Keep this migration deliberately narrow: it grants only DML on the service's
 * runtime schemas plus the transactional outbox. RLS still governs tenant
 * visibility for `fleetvision_app`; `fleetvision_platform` keeps BYPASSRLS for
 * migrations/platform operations.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.raw('GRANT USAGE ON SCHEMA iam TO fleetvision_app, fleetvision_platform');
  await knex.raw('GRANT USAGE ON SCHEMA audit TO fleetvision_app, fleetvision_platform');
  await knex.raw('GRANT USAGE ON SCHEMA public TO fleetvision_app, fleetvision_platform');

  await knex.raw(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA iam TO fleetvision_app, fleetvision_platform',
  );
  await knex.raw(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA audit TO fleetvision_app, fleetvision_platform',
  );
  await knex.raw(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_outbox TO fleetvision_app, fleetvision_platform',
  );

  await knex.raw(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA iam GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fleetvision_app, fleetvision_platform',
  );
  await knex.raw(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA audit GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fleetvision_app, fleetvision_platform',
  );
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.raw(
    'REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA iam FROM fleetvision_app, fleetvision_platform',
  );
  await knex.raw(
    'REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA audit FROM fleetvision_app, fleetvision_platform',
  );
  await knex.raw(
    'REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_outbox FROM fleetvision_app, fleetvision_platform',
  );
  await knex.raw('REVOKE USAGE ON SCHEMA iam FROM fleetvision_app, fleetvision_platform');
  await knex.raw('REVOKE USAGE ON SCHEMA audit FROM fleetvision_app, fleetvision_platform');
}
