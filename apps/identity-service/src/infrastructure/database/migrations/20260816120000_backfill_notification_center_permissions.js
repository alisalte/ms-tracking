/**
 * Sprint H — back-fill the new Notification Center permissions onto existing
 * tenants' system roles.
 *
 * System roles (tenant-admin / fleet-admin / viewer) are seeded only when a
 * tenant is provisioned. Existing tenants therefore lack the Sprint-H
 * `notification.read*` / `notification.preference.*` permissions that the
 * extended notification center API enforces. This migration appends them
 * idempotently:
 *   - tenant-admin: unchanged — its `*` wildcard already satisfies everything.
 *   - fleet-admin: notification.read + notification.read.all + preference
 *     read/write (tenant-wide history visibility).
 *   - viewer: notification.read + own preference read/write (users manage
 *     their OWN preferences only — the API scopes writes to the principal).
 *
 * Idempotent: ON CONFLICT (role_id, permission) DO NOTHING. New tenants get
 * these via SYSTEM_ROLES at provisioning.
 *
 * @param {import("knex").Knex} knex
 */
const GRANTS = {
  'fleet-admin': [
    'notification.read',
    'notification.read.all',
    'notification.preference.read',
    'notification.preference.write',
  ],
  viewer: ['notification.read', 'notification.preference.read', 'notification.preference.write'],
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
