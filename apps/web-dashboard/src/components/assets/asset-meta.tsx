/**
 * Asset visual helpers — single source of truth for the status→color/icon and
 * type→icon maps shared by the four asset tabs and detail drawers. Colors come
 * from the semantic palette (`theme/palette.ts` `status.*`) so the UI never
 * hardcodes hex values.
 */
import {
  Battery,
  BatteryFull,
  BatteryLow,
  Cpu,
  HardDrive,
  type LucideIcon,
  Smartphone,
  Truck,
} from 'lucide-react';

import { status as palette } from '@/theme/palette';
import type {
  DeviceStatus,
  DeviceType,
  DriverStatus,
  GroupStatus,
  VehicleStatus,
} from '@/types/asset.types';

/** Vehicle status → semantic color (Fleet-Management §2). */
export function vehicleStatusColor(s: VehicleStatus): string {
  switch (s) {
    case 'active':
      return palette.green;
    case 'maintenance':
      return palette.amber;
    case 'inactive':
      return palette.slate;
    case 'decommissioned':
    case 'sold':
      return palette.red;
    default:
      return palette.slate;
  }
}

/** Driver status → semantic color (Driver-Management §2). */
export function driverStatusColor(s: DriverStatus): string {
  switch (s) {
    case 'active':
      return palette.green;
    case 'suspended':
      return palette.red;
    case 'terminated':
      return palette.slate;
    default:
      return palette.amber;
  }
}

/** Device status → semantic color (Telemetry §2). */
export function deviceStatusColor(s: DeviceStatus): string {
  switch (s) {
    case 'active':
      return palette.green;
    case 'firmware_updating':
      return palette.blue;
    case 'provisioned':
      return palette.amber;
    case 'faulted':
      return palette.red;
    default:
      return palette.slate;
  }
}

/** Group status → semantic color (Fleet-Management §2 GroupStatus). */
export function groupStatusColor(s: GroupStatus): string {
  return s === 'active' ? palette.green : palette.slate;
}

/** Device hardware type → lucide icon (Telemetry §2 DeviceType). */
export function deviceTypeIcon(t: DeviceType): LucideIcon {
  switch (t) {
    case 'obd2':
      return Cpu;
    case 'gps_tracker':
      return Smartphone;
    case 'dashcam':
      return HardDrive;
    default:
      return Cpu;
  }
}

/** Battery level → lucide icon + color (device-health indicator). */
export function batteryMeta(level: number | undefined): {
  icon: LucideIcon;
  color: string;
} | null {
  if (level === undefined) return null;
  if (level > 60) return { icon: BatteryFull, color: palette.green };
  if (level > 20) return { icon: Battery, color: palette.amber };
  return { icon: BatteryLow, color: palette.red };
}

/** Signal strength (dBm) → color (device-health indicator). */
export function signalColor(dbm: number | undefined): string {
  if (dbm === undefined) return palette.slate;
  if (dbm > -70) return palette.green;
  if (dbm > -85) return palette.amber;
  return palette.red;
}

/** Vehicle body-type icon (reused across map/dashboard/assets). */
export { Truck as VehicleIcon };
