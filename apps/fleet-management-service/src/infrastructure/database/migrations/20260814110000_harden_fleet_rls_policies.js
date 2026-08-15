/**
 * Sprint C — harden the `fleet` RLS policies from the permissive MVP stub
 * (`USING (true) WITH CHECK (true)`) to real fail-closed tenant predicates, the
 * same form Sprint B applied to iam/audit/tracking:
 *
 *   USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
 *   WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
 *
 * `withTenantContext()` sets `app.current_tenant_id` per-transaction from the
 * verified authenticated context. When the GUC is unset the predicate is
 * `tenant_id = NULL` → never true → the policy fails CLOSED (no rows).
 *
 * Same documented limitation as Sprint B: the app connects as the table-owner
 * superuser, so PostgreSQL bypasses RLS and the repository-layer `WHERE tenant_id`
 * filter is the enforcing boundary today. These policies are forward-ready.
 *
 * @param {import("knex").Knex} knex
 */
const PREDICATE = "tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid";

const TABLES = ['fleets', 'vehicles', 'devices', 'vehicle_devices'];

export async function up(knex) {
  for (const table of TABLES) {
    await knex.raw(`DROP POLICY IF EXISTS ${table}_tenant_isolation ON fleet.${table}`);
    await knex.raw(
      `CREATE POLICY ${table}_tenant_isolation ON fleet.${table} USING (${PREDICATE}) WITH CHECK (${PREDICATE})`,
    );
  }
}

export async function down(knex) {
  for (const table of TABLES) {
    await knex.raw(`DROP POLICY IF EXISTS ${table}_tenant_isolation ON fleet.${table}`);
    await knex.raw(
      `CREATE POLICY ${table}_tenant_isolation ON fleet.${table} USING (true) WITH CHECK (true)`,
    );
  }
}
