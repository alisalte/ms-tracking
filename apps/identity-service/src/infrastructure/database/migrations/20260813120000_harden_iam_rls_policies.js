/**
 * Sprint B — harden RLS policies from the permissive MVP stub
 * (`USING (true) WITH CHECK (true)`) to real tenant predicates of the form
 *
 *   USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
 *   WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
 *
 * `current_setting('app.current_tenant_id', true)` returns NULL when the GUC is
 * unset; `NULLIF(NULL,'')::uuid` → NULL; `tenant_id = NULL` is never true → the
 * policy fails CLOSED (no rows) for any query that forgets to set the tenant
 * context. `withTenantContext()` sets the GUC per-transaction from the verified
 * authenticated context.
 *
 * IMPORTANT — current limitation (documented): the application connects to
 * Postgres as the `fleetvision` role, which is the table owner AND a superuser.
 * PostgreSQL BYPASSES Row-Level Security for table owners and superusers
 * (FORCE ROW LEVEL SECURITY does not affect superusers). Therefore RLS is NOT
 * the enforcing tenant boundary today — the authenticated repository-layer
 * `WHERE tenant_id = ?` filter is. These hardened policies are forward-ready:
 * they take effect with no code change once a non-superuser application role is
 * introduced (a future infrastructure sprint). They are NOT `USING(true)` so
 * they are not presented as a (false) security boundary.
 *
 * Per Sprint B, `tracking.vehicle_positions` is intentionally NOT touched here
 * — TimescaleDB forbids compression on a table with RLS, and Sprint A dropped
 * its RLS to enable compression. Its isolation stays at the repository layer.
 *
 * @param {import("knex").Knex} knex
 */
const PREDICATE = "tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid";

const TABLES = [
  'iam.users',
  'iam.password_history',
  'iam.roles',
  'iam.role_permissions',
  'iam.user_roles',
  'iam.organizations',
  'iam.api_keys',
  'iam.refresh_token_families',
  'iam.refresh_tokens',
  'iam.auth_sessions',
  'audit.audit_entries',
];

exports.up = async function up(knex) {
  for (const qualified of TABLES) {
    const [schema, table] = qualified.split('.');
    await knex.raw(`DROP POLICY IF EXISTS "${table}_tenant_isolation" ON "${schema}"."${table}"`);
    await knex.raw(
      `CREATE POLICY "${table}_tenant_isolation" ON "${schema}"."${table}" USING (${PREDICATE}) WITH CHECK (${PREDICATE})`,
    );
  }
};

exports.down = async function down(knex) {
  // Restore the permissive MVP stub.
  for (const qualified of TABLES) {
    const [schema, table] = qualified.split('.');
    await knex.raw(`DROP POLICY IF EXISTS "${table}_tenant_isolation" ON "${schema}"."${table}"`);
    await knex.raw(
      `CREATE POLICY "${table}_tenant_isolation" ON "${schema}"."${table}" USING (true) WITH CHECK (true)`,
    );
  }
};
