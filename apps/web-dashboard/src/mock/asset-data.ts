import type {
  Device,
  DeviceStatus,
  DeviceType,
  Driver,
  DriverStatus,
  FuelType,
  Vehicle,
  VehicleGroup,
  VehicleStatus,
} from '@/types/asset.types';
import type { VehicleType } from '@/types/fleet.types';
/**
 * Static mock asset data — the Asset Management page's single demo data source.
 *
 * Vehicles and drivers are derived deterministically from the existing mock
 * fleet (`mockMapVehicles` + `DRIVERS`) so labels stay consistent across the
 * Map, Dashboard, and Asset surfaces. Devices and groups are generated to
 * cover all status/type combinations. When the fleet/driver/device REST
 * endpoints land, `api/asset.api.ts` swaps these constants for `apiGet`
 * calls + wire→camelCase mapping — the types and UI stay unchanged.
 */
import { mockMapVehicles } from './fleet-data';

/** Tiny deterministic PRNG (mulberry32) — no Math.random so tests are stable. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Drivers reused from the fleet mock (single source of truth for names). */
const DRIVER_NAMES = [
  'M. Chen',
  'A. Rezai',
  'S. Karimi',
  'R. Ahmadi',
  'L. Park',
  'D. Costa',
  'N. Yazdani',
  'H. Müller',
  'F. Ahmadi',
  'T. Okonkwo',
  'J. Garcia',
  'K. Tanaka',
  'O. Adeyemi',
  'P. Singh',
  'E. Dubois',
] as const;

const MAKES: Record<VehicleType, string[]> = {
  truck: ['Volvo', 'Scania', 'Mercedes', 'MAN'],
  van: ['Ford', 'Iveco', 'Renault', 'VW'],
  bus: ['Setra', 'Volvo', 'MAN', 'Mercedes'],
  car: ['Toyota', 'Hyundai', 'VW', 'Kia'],
};
const MODELS: Record<VehicleType, string[]> = {
  truck: ['FH16', 'R500', 'Actros', 'TGX'],
  van: ['Transit', 'Daily', 'Master', 'Crafter'],
  bus: ['S416', '9700', 'Lion', 'O500'],
  car: ['Hilux', 'Tucson', 'Amarok', 'Sorento'],
};
const FUELS: FuelType[] = ['diesel', 'gasoline', 'electric', 'hybrid', 'cng', 'lpg'];
const COLORS = ['White', 'Blue', 'Red', 'Silver', 'Black', 'Grey'];

const VEHICLE_STATUSES: VehicleStatus[] = [
  'active',
  'active',
  'active',
  'maintenance',
  'inactive',
  'decommissioned',
];
const DEVICE_TYPES: DeviceType[] = ['obd2', 'gps_tracker', 'dashcam', 'custom_sensor'];

/** Pick a deterministic element from an array by PRNG. */
function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)] ?? arr[0];
}

/** Generate a fake 17-char VIN (deterministic). */
function fakeVin(rand: () => number): string {
  const chars = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < 17; i++) out += chars[Math.floor(rand() * chars.length)];
  return out;
}

/** Build the vehicle registry from the mock fleet (consistent labels/types). */
function buildVehicles(devices: Device[]): Vehicle[] {
  const rand = seeded(20260811);
  return mockMapVehicles.map((mv) => {
    const type = (mv.type ?? 'truck') as VehicleType;
    const statusRoll = rand();
    const status: VehicleStatus =
      mv.state === 'offline' && statusRoll > 0.5 ? 'inactive' : pick(rand, VEHICLE_STATUSES);
    const device = devices.find((d) => d.boundVehicleId === mv.id);
    return {
      id: mv.id,
      vin: fakeVin(rand),
      make: pick(rand, MAKES[type] ?? MAKES.truck),
      model: pick(rand, MODELS[type] ?? MODELS.truck),
      year: 2016 + Math.floor(rand() * 10),
      licensePlate: `${String.fromCharCode(65 + Math.floor(rand() * 26))}${String.fromCharCode(
        65 + Math.floor(rand() * 26),
      )} ${1000 + Math.floor(rand() * 89999)}`,
      color: pick(rand, COLORS),
      fuelType: pick(rand, FUELS),
      type,
      status,
      fleetId: 'fleet-1',
      fleetName: 'Acme Fleet',
      deviceId: device?.id,
      odometerKm: Math.floor(rand() * 480_000),
      updatedAt: new Date(Date.now() - Math.floor(rand() * 86_400_000)).toISOString(),
    };
  });
}

/** Build the device registry (~30 devices, some bound to vehicles). */
function buildDevices(): Device[] {
  const rand = seeded(20260812);
  const devices: Device[] = [];
  const manufacturers = ['Geotab', 'CalAmp', 'Samsara', 'MiX', 'Teltonika'];
  for (let i = 0; i < 30; i++) {
    const deviceType = DEVICE_TYPES[i % DEVICE_TYPES.length] ?? 'gps_tracker';
    const statusRoll = rand();
    const status: DeviceStatus =
      statusRoll < 0.1
        ? 'faulted'
        : statusRoll < 0.2
          ? 'firmware_updating'
          : statusRoll < 0.3
            ? 'provisioned'
            : statusRoll < 0.45
              ? 'inactive'
              : 'active';
    const boundIdx = i < 24 ? i : -1; // first 24 bind to a vehicle
    const v = boundIdx >= 0 ? mockMapVehicles[boundIdx] : undefined;
    const battery = deviceType === 'gps_tracker' || deviceType === 'custom_sensor';
    devices.push({
      id: `dev-${2000 + i}`,
      serialNumber: `SN${(100000 + i).toString(36).toUpperCase()}`,
      imei: deviceType !== 'custom_sensor' ? `${15 + i}`.padEnd(15, '0').slice(0, 15) : undefined,
      deviceType,
      manufacturer: pick(rand, manufacturers),
      model: `${deviceType.toUpperCase()}-${100 + (i % 9)}`,
      firmwareVersion: `v${1 + Math.floor(rand() * 3)}.${Math.floor(rand() * 9)}.${Math.floor(rand() * 9)}`,
      targetFirmwareVersion: status === 'firmware_updating' ? 'v3.2.0' : undefined,
      status,
      boundVehicleId: v?.id,
      boundVehicleLabel: v?.label,
      lastHeartbeatAt:
        status === 'active' || status === 'firmware_updating'
          ? new Date(Date.now() - Math.floor(rand() * 600_000)).toISOString()
          : undefined,
      lastDataAt:
        status === 'active'
          ? new Date(Date.now() - Math.floor(rand() * 300_000)).toISOString()
          : undefined,
      batteryLevel: battery ? 20 + Math.floor(rand() * 80) : undefined,
      signalStrengthDbm: status === 'active' ? -90 + Math.floor(rand() * 40) : undefined,
      reportingIntervalSec: pick(rand, [10, 15, 30, 60]),
    });
  }
  return devices;
}

/** Build the device registry once (vehicles reference it). */
const mockDevices: Device[] = buildDevices();

/** Build the vehicle registry once. */
const mockVehicles: Vehicle[] = buildVehicles(mockDevices);

/** Build the driver registry (~20 drivers). */
function buildDrivers(): Driver[] {
  const rand = seeded(20260813);
  const classes = ['A', 'B', 'C', 'CDL-A', 'CDL-B'];
  const certs = ['HazMat', 'Tanker', 'Passenger', 'Air Brakes', 'Double/Triple'];
  return DRIVER_NAMES.map((name, i) => {
    // Names are formatted "I. Last" (initial + surname).
    const parts = name.split(' ');
    const firstName = parts[0] ?? name;
    const lastName = parts.slice(1).join(' ') || name;
    const statusRoll = rand();
    const status: DriverStatus =
      statusRoll < 0.1 ? 'suspended' : statusRoll < 0.2 ? 'inactive' : 'active';
    const assigned =
      status === 'active' && rand() > 0.3 ? mockVehicles[i % mockVehicles.length] : undefined;
    return {
      id: `drv-${3000 + i}`,
      firstName,
      lastName,
      email: `${firstName.toLowerCase().replace(/\s/g, '')}.${lastName.toLowerCase()}@acme.com`,
      phone: `+98 912 ${1000000 + i}`,
      employeeId: `EMP-${1000 + i}`,
      status,
      hireDate: new Date(Date.now() - Math.floor(rand() * 5 * 365 * 86_400_000)).toISOString(),
      licenseNumber: `LIC-${200000 + i}`,
      licenseClass: pick(rand, classes),
      licenseExpiry: new Date(
        Date.now() + (Math.floor(rand() * 24) - 6) * 30 * 86_400_000,
      ).toISOString(),
      behaviorScore: 60 + Math.floor(rand() * 40),
      totalTrips: Math.floor(rand() * 2000),
      totalDistanceKm: Math.floor(rand() * 200_000),
      assignedVehicleId: assigned?.id,
      assignedVehicleLabel: assigned ? `${assigned.make} ${assigned.licensePlate}` : undefined,
      certifications: Array.from(
        { length: Math.floor(rand() * 3) },
        (_, k) => certs[k % certs.length] ?? certs[0],
      ),
    };
  });
}

const mockDrivers: Driver[] = buildDrivers();

/** Saved vehicle groups (Fleet-Management §2 VehicleGroup). */
const mockGroups: VehicleGroup[] = [
  {
    id: 'grp-1',
    name: 'High-risk Fleet',
    description: 'Vehicles with recent AI/behavior alerts',
    memberCount: 8,
    vehicleTypeFilter: 'truck',
    status: 'active',
    createdAt: '2026-07-01T00:00:00Z',
  },
  {
    id: 'grp-2',
    name: 'Reefer Trucks',
    description: 'Cold-chain refrigerated vehicles',
    memberCount: 6,
    vehicleTypeFilter: 'truck',
    status: 'active',
    createdAt: '2026-06-15T00:00:00Z',
  },
  {
    id: 'grp-3',
    name: 'City Vans',
    description: 'Last-mile delivery vans',
    memberCount: 12,
    vehicleTypeFilter: 'van',
    status: 'active',
    createdAt: '2026-05-20T00:00:00Z',
  },
  {
    id: 'grp-4',
    name: 'Fleet B',
    description: 'Secondary fleet assets',
    memberCount: 0,
    status: 'archived',
    createdAt: '2025-12-01T00:00:00Z',
  },
];

export { mockDevices, mockVehicles, mockDrivers, mockGroups };

/** Resolve a single vehicle by id (factory, mirrors the detail endpoint). */
export function mockVehicleDetail(id: string): Vehicle | undefined {
  return mockVehicles.find((v) => v.id === id);
}
export function mockDriverDetail(id: string): Driver | undefined {
  return mockDrivers.find((d) => d.id === id);
}
export function mockDeviceDetail(id: string): Device | undefined {
  return mockDevices.find((d) => d.id === id);
}
