/**
 * Tenant license — plan defaults, derived status, login window, and quota math.
 * Pure domain: no I/O. Persistence lives in TenantLicenseRepository.
 */
import { randomBytes } from 'node:crypto';

import type { TenantTier } from './tenant.js';

export const GIB = 1024 * 1024 * 1024;

export type LicensePlanCode = 'TRIAL' | 'STANDARD' | 'PROFESSIONAL' | 'ENTERPRISE' | 'CUSTOM';
export type LicenseStatus = 'ACTIVE' | 'GRACE' | 'EXPIRED';
export type QuotaMetric =
  | 'users'
  | 'vehicles'
  | 'devices'
  | 'drivers'
  | 'storage_bytes'
  | 'download_bytes';
export type QuotaState = 'ok' | 'warn' | 'exceeded';

export interface PlanDefaults {
  readonly planCode: LicensePlanCode;
  readonly tenantTier: TenantTier;
  readonly durationDays: number;
  readonly graceDays: number;
  readonly maxUsers: number;
  readonly maxVehicles: number;
  readonly maxDevices: number;
  readonly maxDrivers: number;
  readonly maxStorageBytes: number;
  readonly maxDownloadBytesMonth: number;
  readonly maxConcurrentSessions: number;
  readonly sessionIdleMinutes: number;
  readonly sessionAbsoluteHours: number;
  readonly timezone: string;
  readonly currency: string;
  readonly basePrice: number;
  readonly unitPriceUsers: number;
  readonly unitPriceVehicles: number;
  readonly unitPriceDevices: number;
  readonly unitPriceDrivers: number;
  readonly unitPriceStorageGib: number;
  readonly unitPriceDownloadGib: number;
}

export interface TenantLicense {
  readonly tenantId: string;
  readonly licenseKey: string;
  readonly planCode: LicensePlanCode;
  readonly startsAt: Date;
  readonly expiresAt: Date;
  readonly graceDays: number;
  readonly maxUsers: number;
  readonly maxVehicles: number;
  readonly maxDevices: number;
  readonly maxDrivers: number;
  readonly maxStorageBytes: number;
  readonly maxDownloadBytesMonth: number;
  readonly maxConcurrentSessions: number;
  readonly sessionIdleMinutes: number;
  readonly sessionAbsoluteHours: number;
  readonly loginHoursStart: number | null;
  readonly loginHoursEnd: number | null;
  readonly timezone: string;
  readonly notes: string | null;
  readonly features: Record<string, unknown>;
  readonly currency: string;
  readonly basePrice: number;
  readonly unitPriceUsers: number;
  readonly unitPriceVehicles: number;
  readonly unitPriceDevices: number;
  readonly unitPriceDrivers: number;
  readonly unitPriceStorageGib: number;
  readonly unitPriceDownloadGib: number;
}

export interface QuotaMeter {
  readonly used: number;
  readonly limit: number;
  readonly pct: number;
  readonly state: QuotaState;
}

export const PLAN_DEFAULTS: Record<LicensePlanCode, PlanDefaults> = {
  TRIAL: {
    planCode: 'TRIAL',
    tenantTier: 'STANDARD',
    durationDays: 14,
    graceDays: 7,
    maxUsers: 3,
    maxVehicles: 5,
    maxDevices: 5,
    maxDrivers: 5,
    maxStorageBytes: 1 * GIB,
    maxDownloadBytesMonth: 5 * GIB,
    maxConcurrentSessions: 2,
    sessionIdleMinutes: 30,
    sessionAbsoluteHours: 8,
    timezone: 'Asia/Tehran',
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
    planCode: 'STANDARD',
    tenantTier: 'STANDARD',
    durationDays: 365,
    graceDays: 7,
    maxUsers: 10,
    maxVehicles: 100,
    maxDevices: 100,
    maxDrivers: 25,
    maxStorageBytes: 10 * GIB,
    maxDownloadBytesMonth: 50 * GIB,
    maxConcurrentSessions: 5,
    sessionIdleMinutes: 30,
    sessionAbsoluteHours: 12,
    timezone: 'Asia/Tehran',
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
    planCode: 'PROFESSIONAL',
    tenantTier: 'PROFESSIONAL',
    durationDays: 365,
    graceDays: 7,
    maxUsers: 50,
    maxVehicles: 500,
    maxDevices: 500,
    maxDrivers: 150,
    maxStorageBytes: 50 * GIB,
    maxDownloadBytesMonth: 200 * GIB,
    maxConcurrentSessions: 20,
    sessionIdleMinutes: 45,
    sessionAbsoluteHours: 16,
    timezone: 'Asia/Tehran',
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
    planCode: 'ENTERPRISE',
    tenantTier: 'ENTERPRISE',
    durationDays: 365,
    graceDays: 7,
    maxUsers: 200,
    maxVehicles: 2000,
    maxDevices: 2000,
    maxDrivers: 500,
    maxStorageBytes: 200 * GIB,
    maxDownloadBytesMonth: 1024 * GIB,
    maxConcurrentSessions: 100,
    sessionIdleMinutes: 60,
    sessionAbsoluteHours: 24,
    timezone: 'Asia/Tehran',
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
    planCode: 'CUSTOM',
    tenantTier: 'STANDARD',
    durationDays: 365,
    graceDays: 7,
    maxUsers: 10,
    maxVehicles: 100,
    maxDevices: 100,
    maxDrivers: 25,
    maxStorageBytes: 10 * GIB,
    maxDownloadBytesMonth: 50 * GIB,
    maxConcurrentSessions: 5,
    sessionIdleMinutes: 30,
    sessionAbsoluteHours: 12,
    timezone: 'Asia/Tehran',
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

const PLAN_PREFIX: Record<LicensePlanCode, string> = {
  TRIAL: 'TRL',
  STANDARD: 'STD',
  PROFESSIONAL: 'PRO',
  ENTERPRISE: 'ENT',
  CUSTOM: 'CST',
};

export function planForTier(tier: TenantTier): LicensePlanCode {
  if (tier === 'ENTERPRISE' || tier === 'PROFESSIONAL') return tier;
  return 'STANDARD';
}

export function generateLicenseKey(plan: LicensePlanCode, now = new Date()): string {
  const year = now.getUTCFullYear();
  const rand = randomBytes(4).toString('hex').toUpperCase();
  return `FV-${PLAN_PREFIX[plan]}-${year}-${rand}`;
}

export function licenseStatus(license: TenantLicense, now = new Date()): LicenseStatus {
  if (now.getTime() < license.expiresAt.getTime()) return 'ACTIVE';
  const graceMs = license.graceDays * 24 * 60 * 60 * 1000;
  if (now.getTime() < license.expiresAt.getTime() + graceMs) return 'GRACE';
  return 'EXPIRED';
}

/** Whole days remaining until expiry (can be negative after expiry). */
export function daysRemaining(license: TenantLicense, now = new Date()): number {
  return Math.ceil((license.expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

export function quotaMeter(used: number, limit: number): QuotaMeter {
  if (limit <= 0) {
    return { used, limit, pct: used > 0 ? 100 : 0, state: used > 0 ? 'exceeded' : 'ok' };
  }
  const pct = Math.min(100, Math.round((used / limit) * 1000) / 10);
  const state: QuotaState = used >= limit ? 'exceeded' : used / limit >= 0.8 ? 'warn' : 'ok';
  return { used, limit, pct, state };
}

export function quotaLimit(license: TenantLicense, metric: QuotaMetric): number {
  switch (metric) {
    case 'users':
      return license.maxUsers;
    case 'vehicles':
      return license.maxVehicles;
    case 'devices':
      return license.maxDevices;
    case 'drivers':
      return license.maxDrivers;
    case 'storage_bytes':
      return license.maxStorageBytes;
    case 'download_bytes':
      return license.maxDownloadBytesMonth;
    default:
      return 0;
  }
}

/** Creating resources is blocked in grace and after expiry. Login stays allowed in grace. */
export function canCreateResources(status: LicenseStatus): boolean {
  return status === 'ACTIVE';
}

export function isWithinQuota(used: number, limit: number): boolean {
  return used < limit;
}

export function hourInTimeZone(now: Date, timeZone: string): number {
  const raw = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    hour12: false,
    timeZone,
  }).format(now);
  const hour = Number(raw);
  return Number.isFinite(hour) ? hour % 24 : now.getUTCHours();
}

/**
 * Inclusive start, exclusive end. Overnight windows (22→6) are supported.
 * Null start/end means no restriction.
 */
export function isWithinLoginHours(
  license: Pick<TenantLicense, 'loginHoursStart' | 'loginHoursEnd' | 'timezone'>,
  now = new Date(),
): boolean {
  const start = license.loginHoursStart;
  const end = license.loginHoursEnd;
  if (start == null || end == null) return true;
  const hour = hourInTimeZone(now, license.timezone || 'UTC');
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export function buildLicense(
  tenantId: string,
  plan: LicensePlanCode,
  overrides: Partial<
    Omit<TenantLicense, 'tenantId' | 'licenseKey' | 'planCode' | 'startsAt' | 'expiresAt'>
  > & {
    licenseKey?: string;
    startsAt?: Date;
    expiresAt?: Date;
  } = {},
  now = new Date(),
): TenantLicense {
  const defaults = PLAN_DEFAULTS[plan];
  const startsAt = overrides.startsAt ?? now;
  const expiresAt =
    overrides.expiresAt ??
    new Date(startsAt.getTime() + defaults.durationDays * 24 * 60 * 60 * 1000);
  return {
    tenantId,
    licenseKey: overrides.licenseKey ?? generateLicenseKey(plan, now),
    planCode: plan,
    startsAt,
    expiresAt,
    graceDays: overrides.graceDays ?? defaults.graceDays,
    maxUsers: overrides.maxUsers ?? defaults.maxUsers,
    maxVehicles: overrides.maxVehicles ?? defaults.maxVehicles,
    maxDevices: overrides.maxDevices ?? defaults.maxDevices,
    maxDrivers: overrides.maxDrivers ?? defaults.maxDrivers,
    maxStorageBytes: overrides.maxStorageBytes ?? defaults.maxStorageBytes,
    maxDownloadBytesMonth: overrides.maxDownloadBytesMonth ?? defaults.maxDownloadBytesMonth,
    maxConcurrentSessions: overrides.maxConcurrentSessions ?? defaults.maxConcurrentSessions,
    sessionIdleMinutes: overrides.sessionIdleMinutes ?? defaults.sessionIdleMinutes,
    sessionAbsoluteHours: overrides.sessionAbsoluteHours ?? defaults.sessionAbsoluteHours,
    loginHoursStart: overrides.loginHoursStart ?? null,
    loginHoursEnd: overrides.loginHoursEnd ?? null,
    timezone: overrides.timezone ?? defaults.timezone,
    notes: overrides.notes ?? null,
    features: overrides.features ?? {},
    currency: overrides.currency ?? defaults.currency,
    basePrice: overrides.basePrice ?? defaults.basePrice,
    unitPriceUsers: overrides.unitPriceUsers ?? defaults.unitPriceUsers,
    unitPriceVehicles: overrides.unitPriceVehicles ?? defaults.unitPriceVehicles,
    unitPriceDevices: overrides.unitPriceDevices ?? defaults.unitPriceDevices,
    unitPriceDrivers: overrides.unitPriceDrivers ?? defaults.unitPriceDrivers,
    unitPriceStorageGib: overrides.unitPriceStorageGib ?? defaults.unitPriceStorageGib,
    unitPriceDownloadGib: overrides.unitPriceDownloadGib ?? defaults.unitPriceDownloadGib,
  };
}
