/**
 * Driver ↔ vehicle ↔ device join (current assignment only).
 *
 * Fleet-service assigns a driver to a vehicle; fleet-management binds a
 * device to a vehicle. There is no driver↔device history API — these helpers
 * resolve who is on which tracker *right now*.
 */
import { driverFullName } from '@/api/driver.api';
import type { Device, Driver } from '@/types/asset.types';

/** Devices currently bound to a vehicle (skips decommissioned hardware). */
export function devicesOnVehicle(devices: readonly Device[], vehicleId: string | null): Device[] {
  if (!vehicleId) return [];
  return devices.filter((d) => d.vehicleId === vehicleId && d.status !== 'DECOMMISSIONED');
}

/** Driver currently assigned to a vehicle (ACTIVE first, then any status). */
export function driverOnVehicle(
  drivers: readonly Driver[],
  vehicleId: string | null,
): Driver | undefined {
  if (!vehicleId) return undefined;
  return (
    drivers.find((d) => d.assignedVehicleId === vehicleId && d.status === 'ACTIVE') ??
    drivers.find((d) => d.assignedVehicleId === vehicleId)
  );
}

/** IMEI, with manufacturer/model when present. */
export function formatDeviceLabel(d: Pick<Device, 'imei' | 'manufacturer' | 'model'>): string {
  const model = [d.manufacturer, d.model].filter(Boolean).join(' ');
  return model ? `${d.imei} · ${model}` : d.imei;
}

export function driverDisplayName(d: Driver | undefined): string | undefined {
  return d ? driverFullName(d) : undefined;
}
