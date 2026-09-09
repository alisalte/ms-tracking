/**
 * Sprint — back-fill report.schedule onto fleet-admin roles.
 *
 * @param {import("knex").Knex} knex
 */
const PERMISSION = 'report.schedule';

export async function up(knex) {
  const roles = await knex('iam.roles').select('id', 'name').where({ name: 'fleet-admin' });
  if (roles.length === 0) return;
  const rows = roles.map((r) => ({ role_id: r.id, permission: PERMISSION }));
  await knex('iam.role_permissions').insert(rows).onConflict(['role_id', 'permission']).ignore();
}

export async function down(knex) {
  await knex('iam.role_permissions').where({ permission: PERMISSION }).delete();
}
