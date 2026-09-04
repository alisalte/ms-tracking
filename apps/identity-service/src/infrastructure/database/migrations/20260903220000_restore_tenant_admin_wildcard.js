/**
 * Restore the tenant-admin `*` wildcard (SYSTEM_ROLES).
 *
 * Some local stacks expanded tenant-admin into an enumerated permission list
 * (the historical `close_wildcard` change). That list never includes
 * service-only scopes such as `device.registry.resolve`, so the seeded admin
 * cannot mint the device-gateway registry key and live devices fail auth.
 *
 * Idempotent: INSERT … ON CONFLICT DO NOTHING. Enumerated rows are left in
 * place; `permissionSatisfies` treats `*` as granting every scope.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  const roles = await knex('iam.roles').select('id').where({ name: 'tenant-admin' });
  if (roles.length === 0) return;
  await knex('iam.role_permissions')
    .insert(roles.map((r) => ({ role_id: r.id, permission: '*' })))
    .onConflict(['role_id', 'permission'])
    .ignore();
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex('iam.role_permissions')
    .where({ permission: '*' })
    .whereIn('role_id', knex('iam.roles').select('id').where({ name: 'tenant-admin' }))
    .delete();
}
