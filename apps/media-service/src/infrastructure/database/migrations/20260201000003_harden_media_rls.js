/**
 * Sprint 1 (Security hardening) — replace permissive RLS on media tables with
 * tenant-aware policies + FORCE RLS. Depends on the `fleetvision_app` role from
 * identity-service's migration.
 *
 * @param {import("knex").Knex} knex
 */
const TENANT_TABLES = [
  { schema: 'media', table: 'video_channels' },
  { schema: 'media', table: 'stream_sessions' },
];

export async function up(knex) {
  for (const { schema, table } of TENANT_TABLES) {
    await harden(knex, schema, table);
  }
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
