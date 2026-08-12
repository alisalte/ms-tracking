/**
 * Sprint 1 (Security hardening) — replace the permissive RLS policies on the
 * tracking tables with real tenant-aware policies and add FORCE ROW LEVEL
 * SECURITY. Depends on the `fleetvision_app` role created by identity-service's
 * 20260201000000 migration (same shared database).
 *
 * @param {import("knex").Knex} knex
 */
const TENANT_TABLES = [
  'vehicle_positions',
  'device_status',
  'trip_events',
  'idle_periods',
  'parking_periods',
];

export async function up(knex) {
  for (const table of TENANT_TABLES) {
    await harden(knex, 'tracking', table);
  }
  // tracking.geofences is created by map-engine's migration but lives in the
  // tracking schema; harden it here too (idempotent if it doesn't exist yet).
  await hardenOptional(knex, 'tracking', 'geofences');
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

async function hardenOptional(knex, schema, table) {
  const qualified = `"${schema}"."${table}"`;
  const policy = `${table}_tenant_isolation`;
  await knex.raw(
    `DO $$ BEGIN
       PERFORM 1 FROM information_schema.tables WHERE table_schema = '${schema}' AND table_name = '${table}';
       IF FOUND THEN
         ALTER TABLE ${qualified} ENABLE ROW LEVEL SECURITY;
         ALTER TABLE ${qualified} FORCE ROW LEVEL SECURITY;
         DROP POLICY IF EXISTS "${policy}" ON ${qualified};
         CREATE POLICY "${policy}" ON ${qualified}
           USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
           WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
       END IF;
     EXCEPTION WHEN OTHERS THEN NULL; END $$;`,
  );
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  for (const table of [...TENANT_TABLES, 'geofences']) {
    const qualified = `"tracking"."${table}"`;
    const policy = `${table}_tenant_isolation`;
    await knex.raw(`ALTER TABLE ${qualified} NO FORCE ROW LEVEL SECURITY`).catch(() => {});
    await knex.raw(`DROP POLICY IF EXISTS "${policy}" ON ${qualified}`).catch(() => {});
    await knex
      .raw(`CREATE POLICY "${policy}" ON ${qualified} USING (true) WITH CHECK (true)`)
      .catch(() => {});
  }
}
