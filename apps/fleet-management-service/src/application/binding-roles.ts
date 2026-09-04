/**
 * A physical unit (especially Meitrack MDVR) can be a tracker, camera, and
 * sensor at once. Binding stores the full set plus a single `role` (TRACKER
 * when present) so older readers keep working.
 */
import { DEVICE_ROLES, type DeviceRole } from '../domain/device/device-types.js';
import type { BindDeviceInput } from './validation/schemas.js';

const ROLE_SET = new Set<string>(DEVICE_ROLES);

export function resolveBindingRoles(input: BindDeviceInput): DeviceRole[] {
  const raw = (input.roles?.length ? input.roles : input.role ? [input.role] : ['TRACKER']).filter(
    (r): r is DeviceRole => ROLE_SET.has(r),
  );
  const seen = new Set<DeviceRole>();
  const unique: DeviceRole[] = [];
  for (const r of raw) {
    if (seen.has(r)) continue;
    seen.add(r);
    unique.push(r);
  }
  return unique.length > 0 ? unique : ['TRACKER'];
}

export function primaryBindingRole(roles: readonly DeviceRole[]): DeviceRole {
  if (roles.includes('TRACKER')) return 'TRACKER';
  return roles[0] ?? 'TRACKER';
}
