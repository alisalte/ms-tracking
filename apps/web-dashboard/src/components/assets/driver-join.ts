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

/**
 * Every active driver on a vehicle, one per shift: any-shift drivers first,
 * then shift 1, 2, 3. A vehicle on a multi-shift operation has several.
 */
export function driversOnVehicle(drivers: readonly Driver[], vehicleId: string | null): Driver[] {
  if (!vehicleId) return [];
  return drivers
    .filter((d) => d.assignedVehicleId === vehicleId && d.status === 'ACTIVE')
    .sort((a, b) => (a.assignedShift ?? 0) - (b.assignedShift ?? 0));
}

/** `Ali (Shift 1), Reza (Shift 2)` — or just names when no shift is set. */
export function driverLabelsOnVehicle(
  drivers: readonly Driver[],
  vehicleId: string | null,
  shiftLabel: (shiftNo: number) => string,
): string | undefined {
  const onVehicle = driversOnVehicle(drivers, vehicleId);
  if (onVehicle.length === 0) return undefined;
  return onVehicle
    .map((d) =>
      d.assignedShift != null
        ? `${driverFullName(d)} (${shiftLabel(d.assignedShift)})`
        : driverFullName(d),
    )
    .join('، ');
}

/** IMEI, with manufacturer/model when present. */
export function formatDeviceLabel(d: Pick<Device, 'imei' | 'manufacturer' | 'model'>): string {
  const model = [d.manufacturer, d.model].filter(Boolean).join(' ');
  return model ? `${d.imei} · ${model}` : d.imei;
}

export function driverDisplayName(d: Driver | undefined): string | undefined {
  return d ? driverFullName(d) : undefined;
}
