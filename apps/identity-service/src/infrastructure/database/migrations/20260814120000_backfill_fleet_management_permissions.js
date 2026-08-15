/**
 * Sprint C — back-fill the new fleet-management permissions onto existing
 * tenants' system roles.
 *
 * System roles (tenant-admin / fleet-admin / viewer) are seeded only when a
 * tenant is provisioned (ProvisionTenantUseCase reads SYSTEM_ROLES). Existing
 * tenants therefore lack the Sprint-C `fleet.*` / `vehicle.*` / `device.*`
 * permissions that the new fleet-management-service enforces. This migration
 * appends them idempotently:
 *   - tenant-admin: unchanged — its single `*` wildcard already satisfies every
 *     permission (no row to add).
 *   - fleet-admin: fleet/vehicle/device read+write.
 *   - viewer: fleet/vehicle/device read.
 *
 * `device.registry.resolve` is deliberately NOT granted to any user role — it
 * is a service-only permission carried by the device-gateway's API key, and the
 * resolve endpoint additionally rejects JWTs. So it is intentionally absent here.
 *
 * Idempotent: ON CONFLICT (role_id, permission) DO NOTHING (the role_permissions
 * PK). Safe to re-run; new tenants get these via SYSTEM_ROLES at provisioning.
 *
 * @param {import("knex").Knex} knex
 */
const GRANTS = {
  'fleet-admin': [
    'fleet.read',
    'fleet.write',
    'vehicle.read',
    'vehicle.write',
    'device.read',
    'device.write',
  ],
  viewer: ['fleet.read', 'vehicle.read', 'device.read'],
};

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
  await knex('iam.role_permissions')
    .whereIn('permission', [
      'fleet.read',
      'fleet.write',
      'vehicle.read',
      'vehicle.write',
      'device.read',
      'device.write',
    ])
    .delete();
}
