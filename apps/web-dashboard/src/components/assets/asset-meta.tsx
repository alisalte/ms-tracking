/**
 * Asset visual helpers — single source of truth for the status/protocol →
 * color maps shared by the asset tabs and detail drawers. Values are tailwind
 * `Badge` color names so the UI never hardcodes hex values.
 *
 * Sprint E: maps mirror the REAL fleet-management enums —
 * FleetStatus/VehicleStatus = ACTIVE|ARCHIVED, DeviceStatus lifecycle =
 * ACTIVE|SUSPENDED|DECOMMISSIONED|UNPAIRED, DeviceProtocol = the gateway's
 * ingest adapters.
 */
import { Truck } from 'lucide-react';

import type { BadgeProps } from '@/components/tailwind-ui';
import type { DeviceProtocol, DeviceStatus, FleetStatus, VehicleStatus } from '@/types/asset.types';

/** Fleet lifecycle status → semantic color (ACTIVE green / ARCHIVED slate). */
export function fleetStatusColor(s: FleetStatus): BadgeProps['color'] {
  return s === 'ACTIVE' ? 'success' : 'gray';
}

/** Vehicle lifecycle status → semantic color (ACTIVE green / ARCHIVED slate). */
export function vehicleStatusColor(s: VehicleStatus): BadgeProps['color'] {
  return s === 'ACTIVE' ? 'success' : 'gray';
}

/** Device REGISTRY lifecycle status → semantic color. */
export function deviceStatusColor(s: DeviceStatus): BadgeProps['color'] {
  switch (s) {
    case 'ACTIVE':
      return 'success';
    case 'SUSPENDED':
      return 'warning';
    case 'DECOMMISSIONED':
      return 'danger';
    case 'UNPAIRED':
      return 'info';
    default:
      return 'gray';
  }
}

/** Ingest protocol → badge color (distinguishes the gateway adapters). */
export function deviceProtocolColor(p: DeviceProtocol): BadgeProps['color'] {
  switch (p) {
    case 'gt06':
      return 'info';
    case 'jt808':
      return 'purple';
    case 'meitrack':
      return 'teal';
    default:
      return 'gray';
  }
}

/** Vehicle body icon (reused across map/dashboard/assets). */
export { Truck as VehicleIcon };
