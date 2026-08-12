/**
 * Sprint 1 (Security hardening) — replace permissive RLS on the telemetry
 * listener table with a tenant-aware policy + FORCE RLS. Depends on the
 * `fleetvision_app` role from identity-service's migration.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  const qualified = '"telemetry"."gateway_listeners"';
  const policy = 'gateway_listeners_tenant_isolation';
  await knex.raw(`ALTER TABLE ${qualified} ENABLE ROW LEVEL SECURITY`);
  await knex.raw(`ALTER TABLE ${qualified} FORCE ROW LEVEL SECURITY`);
  await knex.raw(`DROP POLICY IF EXISTS "${policy}" ON ${qualified}`);
  // gateway_listeners rows are platform-managed (per-pod config), so the policy
  // admits them only under the platform flag; ordinary tenant sessions see none.
  await knex.raw(`
    CREATE POLICY "${policy}" ON ${qualified}
      USING (COALESCE(current_setting('app.is_platform', true)::boolean, false))
      WITH CHECK (COALESCE(current_setting('app.is_platform', true)::boolean, false))
  `);
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  const qualified = '"telemetry"."gateway_listeners"';
  const policy = 'gateway_listeners_tenant_isolation';
  await knex.raw(`ALTER TABLE ${qualified} NO FORCE ROW LEVEL SECURITY`).catch(() => {});
  await knex.raw(`DROP POLICY IF EXISTS "${policy}" ON ${qualified}`).catch(() => {});
  await knex
    .raw(`CREATE POLICY "${policy}" ON ${qualified} USING (true) WITH CHECK (true)`)
    .catch(() => {});
}
