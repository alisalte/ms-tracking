/**
 * Alarm rules can email extra recipients when they fire. Stored as a jsonb
 * array of normalized addresses (max 10, enforced by the API). Existing rules
 * get an empty list — behaviour is unchanged until recipients are added.
 *
 * @param {import("knex").Knex} knex
 */
export async function up(knex) {
  const has = await knex.schema.withSchema('notification').hasColumn('alert_rules', 'recipients');
  if (!has) {
    await knex.schema.withSchema('notification').alterTable('alert_rules', (t) => {
      t.jsonb('recipients').notNullable().defaultTo(JSON.stringify([]));
    });
  }
}

/** @param {import("knex").Knex} knex */
export async function down(knex) {
  await knex.schema.withSchema('notification').alterTable('alert_rules', (t) => {
    t.dropColumn('recipients');
  });
}
