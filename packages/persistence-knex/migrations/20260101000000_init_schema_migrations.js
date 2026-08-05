/**
 * Example migration — creates the `schema_migrations` table that knex itself
 * uses to track applied migrations, plus a tiny `platform_boot_sample` row-table
 * that proves the migration path runs end-to-end (Sprint 1 plan Deliverable 2).
 *
 * No business schema is delivered in Sprint 1 (the aggregate tables land with
 * their bounded contexts in later sprints per docs/specs/03_Database_Architecture.md §5).
 */

/**
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  // knex creates/owns the schema_migrations table automatically; this migration
  // adds a minimal sample table to prove DDL applies and rolls back cleanly.
  await knex.schema.createTable('platform_boot_sample', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').notNullable();
    t.text('note').notNullable();
    t.integer('version').notNullable().defaultTo(1);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

/**
 * @param {import("knex").Knex} knex
 */
export async function down(knex) {
  await knex.schema.dropTableIfExists('platform_boot_sample');
}
