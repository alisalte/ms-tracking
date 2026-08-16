/**
 * Sprint J — back-fill the reporting permissions onto existing tenants'
 * system roles.
 *
 * `report.read` / `report.export` exist in the shared catalog (SYSTEM_ROLES)
 * from Sprint J; existing tenants' roles were seeded before that. Idempotent:
 * ON CONFLICT (role_id, permission) DO NOTHING. tenant-admin's `*` wildcard
 * already satisfies both.
 *
 * @param {import("knex").Knex} knex
 */
const GRANTS = {
  'fleet-admin': ['report.read', 'report.export'],
  viewer: ['report.read'],
};

const ALL_PERMISSIONS = [...new Set(Object.values(GRANTS).flat())];

export async function up(knex) {
  const roles = await knex('iam.roles')
    .select('id', 'tenant_id', 'name')
    .whereIn('name', ['fleet-admin', 'viewer']);

  const rows = [];
  for (const role of roles) {
    for (const permission of GRANTS[role.name] ?? []) {
      rows.push({ role_id: role.id, permission });
    }
  }

  if (rows.length === 0) return;

  await knex('iam.role_permissions').insert(rows).onConflict(['role_id', 'permission']).ignore();
}

export async function down(knex) {
  await knex('iam.role_permissions').whereIn('permission', ALL_PERMISSIONS).delete();
}
