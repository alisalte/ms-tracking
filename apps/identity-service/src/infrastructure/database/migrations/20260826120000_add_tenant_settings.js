/**
 * Persist tenant self-service settings (locale, units, branding, retention)
 * as JSONB on iam.tenants. Empty object = defaults applied at read time.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  await knex.schema.withSchema('iam').alterTable('tenants', (t) => {
    t.jsonb('settings').notNullable().defaultTo('{}');
  });
}

export async function down(knex) {
  await knex.schema.withSchema('iam').alterTable('tenants', (t) => {
    t.dropColumn('settings');
  });
}
