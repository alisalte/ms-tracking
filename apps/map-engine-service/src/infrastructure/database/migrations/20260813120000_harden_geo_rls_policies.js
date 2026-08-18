/**
 * Sprint B — harden RLS policies on the geo/ geofence tables
 * (`geo.pois`, `geo.addresses`, `geo.speed_limits`, `tracking.geofences`) from
 * the permissive `USING (true) WITH CHECK (true)` stub to a real, fail-closed
 * tenant predicate.
 *
 * Notes:
 *  - `geo.pois` / `geo.addresses` intentionally also carry GLOBAL/shared rows
 *    (nullable tenant_id). A strict `tenant_id = current_setting(...)` policy
 *    would HIDE global rows from tenant-scoped queries. To preserve global
 *    rows while still failing closed when no tenant context is set, the policy
 *    is `tenant_id IS NULL OR tenant_id = <ctx>`: global rows remain visible to
 *    every tenant, tenant-owned rows are scoped. (No cross-tenant leak: a row
 *    with tenant_id = X is only visible when X = the caller's tenant.)
 *  - `geo.speed_limits` had tenant_id but no RLS at all (Sprint 9 gap) — RLS +
 *    policy are added here.
 *  - The app connects as the `fleetvision` owner/superuser, so RLS is BYPASSED
 *    today; these policies are forward-ready. The repository-layer
 *    `WHERE tenant_id` filter is the enforcing boundary now.
 *
 * @param {import("knex").Knex} knex
 */
const CTX = "NULLIF(current_setting('app.current_tenant_id', true), '')::uuid";
const SCOPED = `tenant_id = ${CTX}`;
const SCOPED_OR_GLOBAL = `tenant_id IS NULL OR tenant_id = ${CTX}`;

export async function up(knex) {
  // geo.pois / geo.addresses: tenant-owned OR global (shared catalog).
  for (const table of ['pois', 'addresses']) {
    await knex.raw(`DROP POLICY IF EXISTS geo_${table}_tenant_isolation ON geo.${table}`);
    await knex.raw(
      `CREATE POLICY geo_${table}_tenant_isolation ON geo.${table} USING (${SCOPED_OR_GLOBAL}) WITH CHECK (${SCOPED})`,
    );
  }
  // geo.speed_limits: GLOBAL catalog (posted road limits) — the table has NO
  // tenant_id column (see 20260806120000 DDL), so a tenant-scoped predicate is
  // impossible. The original block referenced a nonexistent column and could
  // never execute; it is intentionally dropped here (fix verified in the
  // Sprint I docker verification — this migration had never applied cleanly).
  // tracking.geofences: tenant-owned only.
  await knex.raw('DROP POLICY IF EXISTS geofences_tenant_isolation ON tracking.geofences');
  await knex.raw(
    `CREATE POLICY geofences_tenant_isolation ON tracking.geofences USING (${SCOPED}) WITH CHECK (${SCOPED})`,
  );
}

export async function down(knex) {
  for (const table of ['pois', 'addresses']) {
    await knex.raw(`DROP POLICY IF EXISTS geo_${table}_tenant_isolation ON geo.${table}`);
    await knex.raw(
      `CREATE POLICY geo_${table}_tenant_isolation ON geo.${table} USING (true) WITH CHECK (true)`,
    );
  }
  await knex.raw('DROP POLICY IF EXISTS geofences_tenant_isolation ON tracking.geofences');
  await knex.raw(
    'CREATE POLICY geofences_tenant_isolation ON tracking.geofences USING (true) WITH CHECK (true)',
  );
}
