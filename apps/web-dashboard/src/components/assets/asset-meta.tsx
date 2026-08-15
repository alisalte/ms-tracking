/**
 * Asset visual helpers — single source of truth for the status/protocol →
 * color maps shared by the asset tabs and detail drawers. Colors come from
 * the semantic palette (`theme/palette.ts` `status.*`) so the UI never
 * hardcodes hex values.
 *
 * Sprint E: maps mirror the REAL fleet-management enums —
 * FleetStatus/VehicleStatus = ACTIVE|ARCHIVED, DeviceStatus lifecycle =
 * ACTIVE|SUSPENDED|DECOMMISSIONED|UNPAIRED, DeviceProtocol = the gateway's
 * ingest adapters. The mock-era make/model/fuelType/battery/signal helpers
 * are gone (no such fields on the real records).
 */
import { Truck } from 'lucide-react';

import { status as palette } from '@/theme/palette';
import type { DeviceProtocol, DeviceStatus, FleetStatus, VehicleStatus } from '@/types/asset.types';

/** Fleet lifecycle status → semantic color (ACTIVE green / ARCHIVED slate). */
export function fleetStatusColor(s: FleetStatus): string {
  return s === 'ACTIVE' ? palette.green : palette.slate;
}

/** Vehicle lifecycle status → semantic color (ACTIVE green / ARCHIVED slate). */
export function vehicleStatusColor(s: VehicleStatus): string {
  return s === 'ACTIVE' ? palette.green : palette.slate;
}

/** Device REGISTRY lifecycle status → semantic color. */
export function deviceStatusColor(s: DeviceStatus): string {
  switch (s) {
    case 'ACTIVE':
      return palette.green;
    case 'SUSPENDED':
      return palette.amber;
    case 'DECOMMISSIONED':
      return palette.red;
    case 'UNPAIRED':
      return palette.blue;
    default:
      return palette.slate;
  }
}

/** Ingest protocol → badge color (distinguishes the gateway adapters). */
export function deviceProtocolColor(p: DeviceProtocol): string {
  switch (p) {
    case 'gt06':
      return palette.blue;
    case 'jt808':
      return palette.purple;
    case 'meitrack':
      return palette.teal;
    default:
      return palette.slate;
  }
}

/** Vehicle body icon (reused across map/dashboard/assets). */
export { Truck as VehicleIcon };
