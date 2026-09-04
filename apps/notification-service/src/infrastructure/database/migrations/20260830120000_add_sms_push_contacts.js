/**
 * SMS/push contact tables (already applied on local stacks as batch 2).
 *
 * Knex refuses to boot if a ledger row exists without a matching file.
 * `up` is idempotent: skip when the tables are already present.
 *
 * @param {import('knex').Knex} knex
 */

const ISOLATION = `
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
  OR COALESCE(current_setting('app.is_platform', true)::boolean, false)
`;

async function enableIsolation(knex, table) {
  await knex.raw(`ALTER TABLE notification."${table}" ENABLE ROW LEVEL SECURITY`);
  await knex.raw(`ALTER TABLE notification."${table}" FORCE ROW LEVEL SECURITY`);
  await knex.raw(`DROP POLICY IF EXISTS "${table}_tenant_isolation" ON notification."${table}"`);
  await knex.raw(`
    CREATE POLICY "${table}_tenant_isolation" ON notification."${table}"
      USING (${ISOLATION})
      WITH CHECK (${ISOLATION})
  `);
}

export async function up(knex) {
  const hasContacts = await knex.schema.withSchema('notification').hasTable('user_contacts');
  if (!hasContacts) {
    await knex.schema.withSchema('notification').createTable('user_contacts', (t) => {
      t.uuid('tenant_id').notNullable();
      t.uuid('user_id').notNullable();
      t.string('phone', 32).nullable();
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.primary(['tenant_id', 'user_id']);
    });
  }
  await enableIsolation(knex, 'user_contacts');

  const hasTokens = await knex.schema.withSchema('notification').hasTable('push_device_tokens');
  if (!hasTokens) {
    await knex.schema.withSchema('notification').createTable('push_device_tokens', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('user_id').notNullable();
      t.text('token').notNullable();
      t.string('platform', 32).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['tenant_id', 'user_id', 'token']);
    });
  }
  await enableIsolation(knex, 'push_device_tokens');

  await knex.raw(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA notification TO fleetvision_app, fleetvision_platform',
  );
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.raw(
    'DROP POLICY IF EXISTS push_device_tokens_tenant_isolation ON notification.push_device_tokens',
  );
  await knex.raw(
    'DROP POLICY IF EXISTS user_contacts_tenant_isolation ON notification.user_contacts',
  );
  await knex.schema.withSchema('notification').dropTableIfExists('push_device_tokens');
  await knex.schema.withSchema('notification').dropTableIfExists('user_contacts');
}
