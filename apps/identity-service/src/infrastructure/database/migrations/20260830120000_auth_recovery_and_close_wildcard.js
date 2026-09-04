/**
 * Auth recovery tables (already applied on local stacks as batch 2).
 *
 * Knex refuses to boot if a ledger row exists without a matching file.
 * This module restores that filename. `up` is idempotent so a fresh database
 * still gets the tables, and an already-migrated database is a no-op.
 *
 *   - iam.password_reset_tokens
 *   - iam.mfa_factors
 *
 * @param {import('knex').Knex} knex
 */

const TENANT_PREDICATE =
  "tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid";
const PLATFORM_PREDICATE = "current_setting('app.is_platform', true) = 'true'";
const PREDICATE = `(${PLATFORM_PREDICATE}) OR (${TENANT_PREDICATE})`;

async function enableIsolation(knex, table) {
  await knex.raw(`ALTER TABLE iam."${table}" ENABLE ROW LEVEL SECURITY`);
  await knex.raw(`ALTER TABLE iam."${table}" FORCE ROW LEVEL SECURITY`);
  await knex.raw(`DROP POLICY IF EXISTS "${table}_tenant_isolation" ON iam."${table}"`);
  await knex.raw(
    `CREATE POLICY "${table}_tenant_isolation" ON iam."${table}" USING (${PREDICATE}) WITH CHECK (${PREDICATE})`,
  );
}

export async function up(knex) {
  const hasReset = await knex.schema.withSchema('iam').hasTable('password_reset_tokens');
  if (!hasReset) {
    await knex.schema.withSchema('iam').createTable('password_reset_tokens', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('user_id').notNullable().references('id').inTable('iam.users').onDelete('CASCADE');
      t.text('token_hash')
        .notNullable()
        .unique({ indexName: 'password_reset_tokens_token_hash_unique' });
      t.timestamp('expires_at', { useTz: true }).notNullable();
      t.timestamp('used_at', { useTz: true }).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
    await knex.raw(
      'CREATE INDEX iam_password_reset_tokens_tenant_user_idx ON iam.password_reset_tokens (tenant_id, user_id)',
    );
  }
  await enableIsolation(knex, 'password_reset_tokens');

  const hasMfa = await knex.schema.withSchema('iam').hasTable('mfa_factors');
  if (!hasMfa) {
    await knex.schema.withSchema('iam').createTable('mfa_factors', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('user_id').notNullable().references('id').inTable('iam.users').onDelete('CASCADE');
      t.text('kind').notNullable();
      t.text('secret').notNullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['user_id', 'kind'], { indexName: 'iam_mfa_factors_user_kind_unique' });
    });
    await knex.raw(
      'CREATE INDEX iam_mfa_factors_tenant_user_idx ON iam.mfa_factors (tenant_id, user_id)',
    );
  }
  await enableIsolation(knex, 'mfa_factors');

  await knex.raw(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA iam TO fleetvision_app, fleetvision_platform',
  );
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.raw('DROP POLICY IF EXISTS mfa_factors_tenant_isolation ON iam.mfa_factors');
  await knex.raw(
    'DROP POLICY IF EXISTS password_reset_tokens_tenant_isolation ON iam.password_reset_tokens',
  );
  await knex.schema.withSchema('iam').dropTableIfExists('mfa_factors');
  await knex.schema.withSchema('iam').dropTableIfExists('password_reset_tokens');
}
