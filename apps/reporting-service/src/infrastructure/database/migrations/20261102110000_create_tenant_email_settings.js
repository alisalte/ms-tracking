/**
 * Per-tenant SMTP settings for scheduled-report email. The password is stored
 * encrypted (AES-256-GCM, app-level) and is never returned by any API.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.raw('CREATE SCHEMA IF NOT EXISTS reporting');
  const has = await knex.schema.withSchema('reporting').hasTable('tenant_email_settings');
  if (!has) {
    await knex.schema.withSchema('reporting').createTable('tenant_email_settings', (t) => {
      t.uuid('tenant_id').primary();
      t.boolean('enabled').notNullable().defaultTo(true);
      t.text('host').notNullable();
      t.integer('port').notNullable().defaultTo(587);
      t.boolean('secure').notNullable().defaultTo(false);
      t.text('username').nullable();
      t.text('password_enc').nullable();
      t.text('from_address').notNullable();
      t.uuid('updated_by').nullable();
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }
  const table = 'tenant_email_settings';
  await knex.raw(`ALTER TABLE reporting."${table}" ENABLE ROW LEVEL SECURITY`);
  await knex.raw(`ALTER TABLE reporting."${table}" FORCE ROW LEVEL SECURITY`);
  await knex.raw(`DROP POLICY IF EXISTS "${table}_tenant_isolation" ON reporting."${table}"`);
  await knex.raw(`
    CREATE POLICY "${table}_tenant_isolation" ON reporting."${table}"
      USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR COALESCE(current_setting('app.is_platform', true)::boolean, false)
      )
      WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR COALESCE(current_setting('app.is_platform', true)::boolean, false)
      )
  `);
  await knex.raw(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON reporting."${table}" TO fleetvision_app, fleetvision_platform`,
  );
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.raw(
    'DROP POLICY IF EXISTS "tenant_email_settings_tenant_isolation" ON reporting."tenant_email_settings"',
  );
  await knex.schema.withSchema('reporting').dropTableIfExists('tenant_email_settings');
}
