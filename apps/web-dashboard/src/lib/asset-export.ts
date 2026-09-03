/**
 * Excel export for the asset registry (`/assets`).
 *
 * Vehicles, devices, and drivers use the same column names as import so a
 * downloaded workbook can be edited and re-uploaded. Status is extra on
 * export and ignored on import.
 */
import { xlsxBlob } from '@/lib/spreadsheet';
import { downloadBlob } from '@/lib/video-stream';
import type { Device, Driver, Fleet, Vehicle } from '@/types/asset.types';

export type AssetExportKind = 'fleets' | 'vehicles' | 'devices' | 'drivers';

function cell(value: string | number | null | undefined): string {
  if (value == null) return '';
  return String(value);
}

function dateCell(value: string | null | undefined): string {
  if (!value) return '';
  return value.slice(0, 10);
}

function fullName(d: Pick<Driver, 'firstName' | 'lastName'>): string {
  return `${d.firstName} ${d.lastName}`.trim();
}

function stamp(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function buildFleetsExportGrid(fleets: Fleet[]): string[][] {
  return [
    ['name', 'code', 'description', 'status'],
    ...fleets.map((f) => [f.name, f.code, cell(f.description), f.status]),
  ];
}

export function buildVehiclesExportGrid(vehicles: Vehicle[], fleets: Fleet[]): string[][] {
  const codeById = new Map(fleets.map((f) => [f.id, f.code]));
  return [
    ['name', 'code', 'fleetCode', 'plate', 'vin', 'odometerKm', 'engineHours', 'status'],
    ...vehicles.map((v) => [
      v.name,
      v.code,
      codeById.get(v.fleetId) ?? '',
      cell(v.plate),
      cell(v.vin),
      cell(v.odometerKm),
      cell(v.engineHours),
      v.status,
    ]),
  ];
}

export function buildDevicesExportGrid(devices: Device[], vehicles: Vehicle[]): string[][] {
  const codeById = new Map(vehicles.map((v) => [v.id, v.code]));
  return [
    ['imei', 'protocol', 'serialNumber', 'manufacturer', 'model', 'vehicleCode', 'status'],
    ...devices.map((d) => [
      d.imei,
      d.protocol,
      cell(d.serialNumber),
      cell(d.manufacturer),
      cell(d.model),
      d.vehicleId ? (codeById.get(d.vehicleId) ?? '') : '',
      d.status,
    ]),
  ];
}

export function buildDriversExportGrid(drivers: Driver[], vehicles: Vehicle[]): string[][] {
  const codeById = new Map(vehicles.map((v) => [v.id, v.code]));
  return [
    [
      'firstName',
      'lastName',
      'licenseNumber',
      'employeeId',
      'email',
      'phone',
      'licenseClass',
      'licenseIssued',
      'licenseExpires',
      'licenseCountry',
      'vehicleCode',
      'status',
    ],
    ...drivers.map((d) => [
      d.firstName,
      d.lastName,
      d.licenseNumber,
      cell(d.employeeId),
      cell(d.email),
      cell(d.phone),
      cell(d.licenseClass),
      dateCell(d.licenseIssued),
      dateCell(d.licenseExpires),
      cell(d.licenseCountry),
      d.assignedVehicleId ? (codeById.get(d.assignedVehicleId) ?? '') : '',
      d.status,
    ]),
  ];
}

export interface AssetExportFilters {
  fleetStatus: Fleet['status'] | 'all';
  fleetQuery: string;
  vehStatus: Vehicle['status'] | 'all';
  vehFleet: string | 'all';
  vehQuery: string;
  devStatus: Device['status'] | 'all';
  devProtocol: Device['protocol'] | 'all';
  devQuery: string;
  drvStatus: Driver['status'] | 'all';
  drvQuery: string;
}

export function filterFleetsForExport(
  fleets: Fleet[],
  status: Fleet['status'] | 'all',
  query: string,
): Fleet[] {
  const q = query.trim().toLowerCase();
  return fleets.filter((f) => {
    if (status !== 'all' && f.status !== status) return false;
    if (!q) return true;
    return (
      f.name.toLowerCase().includes(q) ||
      f.code.toLowerCase().includes(q) ||
      (f.description?.toLowerCase().includes(q) ?? false)
    );
  });
}

export function filterVehiclesForExport(
  vehicles: Vehicle[],
  fleets: Fleet[],
  status: Vehicle['status'] | 'all',
  fleetId: string | 'all',
  query: string,
): Vehicle[] {
  const q = query.trim().toLowerCase();
  const nameById = new Map(fleets.map((f) => [f.id, f.name]));
  return vehicles.filter((v) => {
    if (status !== 'all' && v.status !== status) return false;
    if (fleetId !== 'all' && v.fleetId !== fleetId) return false;
    if (!q) return true;
    const fleetName = (nameById.get(v.fleetId) ?? '').toLowerCase();
    return (
      v.name.toLowerCase().includes(q) ||
      v.code.toLowerCase().includes(q) ||
      (v.plate?.toLowerCase().includes(q) ?? false) ||
      (v.vin?.toLowerCase().includes(q) ?? false) ||
      fleetName.includes(q)
    );
  });
}

export function filterDevicesForExport(
  devices: Device[],
  vehicles: Vehicle[],
  drivers: Driver[],
  status: Device['status'] | 'all',
  protocol: Device['protocol'] | 'all',
  query: string,
): Device[] {
  const q = query.trim().toLowerCase();
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  const driverByVehicle = new Map(
    drivers.filter((d) => d.assignedVehicleId).map((d) => [d.assignedVehicleId as string, d]),
  );
  return devices.filter((d) => {
    if (status !== 'all' && d.status !== status) return false;
    if (protocol !== 'all' && d.protocol !== protocol) return false;
    if (!q) return true;
    const vehicle = d.vehicleId ? vehicleById.get(d.vehicleId) : undefined;
    const assigned = d.vehicleId ? driverByVehicle.get(d.vehicleId) : undefined;
    const driverName = assigned ? fullName(assigned).toLowerCase() : '';
    return (
      d.imei.toLowerCase().includes(q) ||
      (d.serialNumber?.toLowerCase().includes(q) ?? false) ||
      (d.manufacturer?.toLowerCase().includes(q) ?? false) ||
      (d.model?.toLowerCase().includes(q) ?? false) ||
      (vehicle?.name.toLowerCase().includes(q) ?? false) ||
      driverName.includes(q)
    );
  });
}

export function filterDriversForExport(
  drivers: Driver[],
  vehicles: Vehicle[],
  devices: Device[],
  status: Driver['status'] | 'all',
  query: string,
): Driver[] {
  const q = query.trim().toLowerCase();
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  const devicesByVehicle = new Map<string, Device[]>();
  for (const d of devices) {
    if (!d.vehicleId) continue;
    const list = devicesByVehicle.get(d.vehicleId) ?? [];
    list.push(d);
    devicesByVehicle.set(d.vehicleId, list);
  }
  return drivers.filter((d) => {
    if (status !== 'all' && d.status !== status) return false;
    if (!q) return true;
    const vehicle = d.assignedVehicleId ? vehicleById.get(d.assignedVehicleId) : undefined;
    const bound = d.assignedVehicleId ? (devicesByVehicle.get(d.assignedVehicleId) ?? []) : [];
    return (
      fullName(d).toLowerCase().includes(q) ||
      (d.email?.toLowerCase().includes(q) ?? false) ||
      d.licenseNumber.toLowerCase().includes(q) ||
      (d.employeeId?.toLowerCase().includes(q) ?? false) ||
      (vehicle?.name.toLowerCase().includes(q) ?? false) ||
      bound.some(
        (dev) =>
          dev.imei.toLowerCase().includes(q) ||
          (dev.serialNumber?.toLowerCase().includes(q) ?? false),
      )
    );
  });
}

export function buildAssetExport(
  kind: AssetExportKind,
  data: { fleets: Fleet[]; vehicles: Vehicle[]; devices: Device[]; drivers: Driver[] },
  filters: AssetExportFilters,
): { blob: Blob; filename: string } {
  if (kind === 'fleets') {
    const rows = buildFleetsExportGrid(
      filterFleetsForExport(data.fleets, filters.fleetStatus, filters.fleetQuery),
    );
    return { blob: xlsxBlob('Fleets', rows), filename: `fleets-${stamp()}.xlsx` };
  }
  if (kind === 'vehicles') {
    const rows = buildVehiclesExportGrid(
      filterVehiclesForExport(
        data.vehicles,
        data.fleets,
        filters.vehStatus,
        filters.vehFleet,
        filters.vehQuery,
      ),
      data.fleets,
    );
    return { blob: xlsxBlob('Vehicles', rows), filename: `vehicles-${stamp()}.xlsx` };
  }
  if (kind === 'devices') {
    const rows = buildDevicesExportGrid(
      filterDevicesForExport(
        data.devices,
        data.vehicles,
        data.drivers,
        filters.devStatus,
        filters.devProtocol,
        filters.devQuery,
      ),
      data.vehicles,
    );
    return { blob: xlsxBlob('Devices', rows), filename: `devices-${stamp()}.xlsx` };
  }
  const rows = buildDriversExportGrid(
    filterDriversForExport(
      data.drivers,
      data.vehicles,
      data.devices,
      filters.drvStatus,
      filters.drvQuery,
    ),
    data.vehicles,
  );
  return { blob: xlsxBlob('Drivers', rows), filename: `drivers-${stamp()}.xlsx` };
}

export function downloadAssetExport(
  kind: AssetExportKind,
  data: { fleets: Fleet[]; vehicles: Vehicle[]; devices: Device[]; drivers: Driver[] },
  filters: AssetExportFilters,
): void {
  const { blob, filename } = buildAssetExport(kind, data, filters);
  downloadBlob(blob, filename);
}
