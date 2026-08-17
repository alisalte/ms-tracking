/**
 * Device Commands — back-fill the `telemetry.command.*` permissions onto
 * existing tenants' system roles (docs/specs/02_Domain_Model.md §6.1 catalog).
 *
 * The device-configuration feature (fleet-management POST /devices/:id/commands,
 * GET /device-commands/*) enforces:
 *   - telemetry.command.send — issue commands to devices
 *   - telemetry.command.read — catalog + history
 *
 * Grants (mirroring the Sprint-C fleet backfill pattern):
 *   - tenant-admin: unchanged — the `*` wildcard already satisfies both.
 *   - fleet-admin:  send + read.
 *   - viewer:       read.
 *
 * Idempotent: ON CONFLICT (role_id, permission) DO NOTHING.
 *
 * @param {import("knex").Knex} knex
 */
const GRANTS = {
  'fleet-admin': ['telemetry.command.send', 'telemetry.command.read'],
  viewer: ['telemetry.command.read'],
};

export async function up(knex) {
  const roles = await knex('iam.roles')
    .select('id', 'name')
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
    .whereIn('permission', ['telemetry.command.send', 'telemetry.command.read'])
    .delete();
}
