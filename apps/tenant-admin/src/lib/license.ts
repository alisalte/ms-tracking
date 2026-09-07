export const GIB = 1024 * 1024 * 1024;

export type LicensePlanCode = 'TRIAL' | 'STANDARD' | 'PROFESSIONAL' | 'ENTERPRISE' | 'CUSTOM';

export const PLAN_CODES: LicensePlanCode[] = [
  'TRIAL',
  'STANDARD',
  'PROFESSIONAL',
  'ENTERPRISE',
  'CUSTOM',
];

export interface PlanPreset {
  plan: LicensePlanCode;
  tier: 'STANDARD' | 'PROFESSIONAL' | 'ENTERPRISE';
  durationDays: number;
  maxUsers: number;
  maxVehicles: number;
  maxDevices: number;
  maxDrivers: number;
  storageGib: number;
  downloadGib: number;
  sessions: number;
  idleMinutes: number;
  absoluteHours: number;
  currency: string;
  basePrice: number;
  unitPriceUsers: number;
  unitPriceVehicles: number;
  unitPriceDevices: number;
  unitPriceDrivers: number;
  unitPriceStorageGib: number;
  unitPriceDownloadGib: number;
}

export const PLAN_PRESETS: Record<LicensePlanCode, PlanPreset> = {
  TRIAL: {
    plan: 'TRIAL',
    tier: 'STANDARD',
    durationDays: 14,
    maxUsers: 3,
    maxVehicles: 5,
    maxDevices: 5,
    maxDrivers: 5,
    storageGib: 1,
    downloadGib: 5,
    sessions: 2,
    idleMinutes: 30,
    absoluteHours: 8,
    currency: 'IRR',
    basePrice: 0,
    unitPriceUsers: 0,
    unitPriceVehicles: 0,
    unitPriceDevices: 0,
    unitPriceDrivers: 0,
    unitPriceStorageGib: 0,
    unitPriceDownloadGib: 0,
  },
  STANDARD: {
    plan: 'STANDARD',
    tier: 'STANDARD',
    durationDays: 365,
    maxUsers: 10,
    maxVehicles: 100,
    maxDevices: 100,
    maxDrivers: 25,
    storageGib: 10,
    downloadGib: 50,
    sessions: 5,
    idleMinutes: 30,
    absoluteHours: 12,
    currency: 'IRR',
    basePrice: 15_000_000,
    unitPriceUsers: 250_000,
    unitPriceVehicles: 100_000,
    unitPriceDevices: 60_000,
    unitPriceDrivers: 80_000,
    unitPriceStorageGib: 25_000,
    unitPriceDownloadGib: 10_000,
  },
  PROFESSIONAL: {
    plan: 'PROFESSIONAL',
    tier: 'PROFESSIONAL',
    durationDays: 365,
    maxUsers: 50,
    maxVehicles: 500,
    maxDevices: 500,
    maxDrivers: 150,
    storageGib: 50,
    downloadGib: 200,
    sessions: 20,
    idleMinutes: 45,
    absoluteHours: 16,
    currency: 'IRR',
    basePrice: 45_000_000,
    unitPriceUsers: 200_000,
    unitPriceVehicles: 80_000,
    unitPriceDevices: 45_000,
    unitPriceDrivers: 70_000,
    unitPriceStorageGib: 20_000,
    unitPriceDownloadGib: 8_000,
  },
  ENTERPRISE: {
    plan: 'ENTERPRISE',
    tier: 'ENTERPRISE',
    durationDays: 365,
    maxUsers: 200,
    maxVehicles: 2000,
    maxDevices: 2000,
    maxDrivers: 500,
    storageGib: 200,
    downloadGib: 1024,
    sessions: 100,
    idleMinutes: 60,
    absoluteHours: 24,
    currency: 'IRR',
    basePrice: 120_000_000,
    unitPriceUsers: 150_000,
    unitPriceVehicles: 50_000,
    unitPriceDevices: 30_000,
    unitPriceDrivers: 50_000,
    unitPriceStorageGib: 15_000,
    unitPriceDownloadGib: 5_000,
  },
  CUSTOM: {
    plan: 'CUSTOM',
    tier: 'STANDARD',
    durationDays: 365,
    maxUsers: 10,
    maxVehicles: 100,
    maxDevices: 100,
    maxDrivers: 25,
    storageGib: 10,
    downloadGib: 50,
    sessions: 5,
    idleMinutes: 30,
    absoluteHours: 12,
    currency: 'IRR',
    basePrice: 15_000_000,
    unitPriceUsers: 250_000,
    unitPriceVehicles: 100_000,
    unitPriceDevices: 60_000,
    unitPriceDrivers: 80_000,
    unitPriceStorageGib: 25_000,
    unitPriceDownloadGib: 10_000,
  },
};

export function bytesToGib(bytes: number): number {
  return Math.round((bytes / GIB) * 100) / 100;
}

export function gibToBytes(gib: number): number {
  return Math.round(gib * GIB);
}

export function isoDateOnly(iso: string | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

export function addDaysIso(days: number, from = new Date()): string {
  const d = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
