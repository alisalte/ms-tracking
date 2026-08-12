/**
 * Sprint 1 (Security hardening) — replace permissive RLS on geo/tracking tables
 * owned by map-engine with tenant-aware policies + FORCE RLS. `geo.pois` and
 * `geo.addresses` carry tenant_id; `tracking.geofences` (created here) too.
 * Depends on the `fleetvision_app` role from identity-service's migration.
 *
 * @param {import("knex").Knex} knex
 */
const TENANT_TABLES = [
  { schema: 'geo', table: 'pois' },
  { schema: 'geo', table: 'addresses' },
  { schema: 'tracking', table: 'geofences' },
];

export async function up(knex) {
  for (const { schema, table } of TENANT_TABLES) {
    if (schema === 'geo' && table === 'pois') {
      // geo.pois supports both tenant-scoped AND platform-shared (tenant_id IS
      // NULL) rows, so the policy admits null-tenant rows in addition to the
      // caller's tenant.
      await hardenNullable(knex, 'geo', 'pois');
    } else {
      await harden(knex, schema, table);
    }
  }
}

async function hardenNullable(knex, schema, table) {
  const qualified = `"${schema}"."${table}"`;
  const policy = `${table}_tenant_isolation`;
  await knex.raw(`ALTER TABLE ${qualified} ENABLE ROW LEVEL SECURITY`);
  await knex.raw(`ALTER TABLE ${qualified} FORCE ROW LEVEL SECURITY`);
  await knex.raw(`DROP POLICY IF EXISTS "${policy}" ON ${qualified}`);
  await knex.raw(`
    CREATE POLICY "${policy}" ON ${qualified}
      USING (
        tenant_id IS NULL
        OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
      )
      WITH CHECK (
        tenant_id IS NULL
        OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
      )
  `);
}

async function harden(knex, schema, table) {
  const qualified = `"${schema}"."${table}"`;
  const policy = `${table}_tenant_isolation`;
  await knex.raw(`ALTER TABLE ${qualified} ENABLE ROW LEVEL SECURITY`);
  await knex.raw(`ALTER TABLE ${qualified} FORCE ROW LEVEL SECURITY`);
  await knex.raw(`DROP POLICY IF EXISTS "${policy}" ON ${qualified}`);
  await knex.raw(`
    CREATE POLICY "${policy}" ON ${qualified}
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  `);
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  for (const { schema, table } of TENANT_TABLES) {
    const qualified = `"${schema}"."${table}"`;
    const policy = `${table}_tenant_isolation`;
    await knex.raw(`ALTER TABLE ${qualified} NO FORCE ROW LEVEL SECURITY`).catch(() => {});
    await knex.raw(`DROP POLICY IF EXISTS "${policy}" ON ${qualified}`).catch(() => {});
    await knex
      .raw(`CREATE POLICY "${policy}" ON ${qualified} USING (true) WITH CHECK (true)`)
      .catch(() => {});
  }
}
