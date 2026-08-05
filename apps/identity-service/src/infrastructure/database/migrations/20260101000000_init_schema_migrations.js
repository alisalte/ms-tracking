/**
 * identity-service example migration — creates the `schema_migrations` bookkeeping
 * table knex uses, plus a tiny sample table proving the migration path. The real
 * `iam` schema (users/credentials/auth_sessions) lands with the auth epic.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('platform_boot_sample', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.text('note').notNullable();
    t.integer('version').notNullable().defaultTo(1);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('platform_boot_sample');
}
