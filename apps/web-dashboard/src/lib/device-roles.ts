import type { DeviceProtocol, DeviceRole } from '@/types/asset.types';

export const DEVICE_ROLE_OPTIONS: DeviceRole[] = ['TRACKER', 'MDVR', 'CAN', 'SENSOR', 'OTHER'];

/** Meitrack MDVR units carry GPS + cameras; other protocols are trackers. */
export function defaultDeviceRoles(protocol?: DeviceProtocol | string | null): DeviceRole[] {
  if (protocol === 'meitrack') return ['TRACKER', 'MDVR'];
  return ['TRACKER'];
}

export function primaryDeviceRole(roles: readonly DeviceRole[]): DeviceRole {
  if (roles.includes('TRACKER')) return 'TRACKER';
  return roles[0] ?? 'TRACKER';
}

export function displayDeviceRoles(role: string, roles?: readonly string[] | null): string[] {
  if (roles && roles.length > 0) return [...roles];
  return role ? [role] : [];
}
