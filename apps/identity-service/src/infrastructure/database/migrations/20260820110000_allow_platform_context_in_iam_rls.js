/**
 * Allow explicit platform operations through hardened IAM/audit RLS policies.
 *
 * The app role is intentionally non-BYPASSRLS. Cross-tenant operations such as
 * bootstrap seeding and platform-wide username lookup run through
 * `withoutTenantContext()`, which sets `app.is_platform = 'true'` for the
 * transaction. These policies allow that explicit platform context while still
 * failing closed for ordinary queries that forget tenant context.
 *
 * @param {import('knex').Knex} knex
 */
const TENANT_PREDICATE =
  "tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid";
const PLATFORM_PREDICATE = "current_setting('app.is_platform', true) = 'true'";
const PREDICATE = `(${PLATFORM_PREDICATE}) OR (${TENANT_PREDICATE})`;

const TABLES = [
  'iam.users',
  'iam.password_history',
  'iam.roles',
  'iam.user_roles',
  'iam.organizations',
  'iam.api_keys',
  'iam.refresh_token_families',
  'iam.auth_sessions',
  'audit.audit_entries',
];

export async function up(knex) {
  for (const qualified of TABLES) {
    const [schema, table] = qualified.split('.');
    await knex.raw(`DROP POLICY IF EXISTS "${table}_tenant_isolation" ON "${schema}"."${table}"`);
    await knex.raw(
      `CREATE POLICY "${table}_tenant_isolation" ON "${schema}"."${table}" USING (${PREDICATE}) WITH CHECK (${PREDICATE})`,
    );
  }

  await knex.raw('DROP POLICY IF EXISTS tenants_isolation ON iam.tenants');
  await knex.raw(
    `CREATE POLICY tenants_isolation ON iam.tenants USING (${PREDICATE}) WITH CHECK (${PREDICATE})`,
  );
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  for (const qualified of TABLES) {
    const [schema, table] = qualified.split('.');
    await knex.raw(`DROP POLICY IF EXISTS "${table}_tenant_isolation" ON "${schema}"."${table}"`);
    await knex.raw(
      `CREATE POLICY "${table}_tenant_isolation" ON "${schema}"."${table}" USING (${TENANT_PREDICATE}) WITH CHECK (${TENANT_PREDICATE})`,
    );
  }

  await knex.raw('DROP POLICY IF EXISTS tenants_isolation ON iam.tenants');
  await knex.raw(
    `CREATE POLICY tenants_isolation ON iam.tenants USING (${TENANT_PREDICATE}) WITH CHECK (${TENANT_PREDICATE})`,
  );
}
