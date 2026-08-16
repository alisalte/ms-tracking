/**
 * Sprint I — back-fill the geofence/map permissions onto existing tenants'
 * system roles.
 *
 * Sprint I turns geofences into a first-class CRUD surface (`maps.read` /
 * `maps.write` on every /geofences route + the drawing UI behind the same
 * permission gate). These permissions exist in the shared catalog
 * (`packages/auth` SYSTEM_ROLES) since Sprint B, but existing tenants' roles
 * were seeded before that — and Sprint B never shipped a back-fill for them
 * (the fleet-management back-fill of 20260814 covered fleet.* only). This
 * migration appends them idempotently:
 *   - tenant-admin: unchanged — its `*` wildcard already satisfies everything.
 *   - fleet-admin: maps.read + maps.write (full geofence management).
 *   - viewer: maps.read (see fences + tracks, no mutations).
 *
 * Idempotent: ON CONFLICT (role_id, permission) DO NOTHING. New tenants get
 * these via SYSTEM_ROLES at provisioning.
 *
 * @param {import("knex").Knex} knex
 */
const GRANTS = {
  'fleet-admin': ['maps.read', 'maps.write'],
  viewer: ['maps.read'],
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
