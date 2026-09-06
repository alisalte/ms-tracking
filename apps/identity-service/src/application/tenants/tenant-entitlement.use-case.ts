/**
 * Tenant entitlement — license lookup, login gates, and create-quota checks.
 */
import { Injectable } from '@nestjs/common';
import {
  NotFoundError,
  TenantLicenseExpiredError,
  TenantLoginWindowError,
  TenantQuotaExceededError,
  TenantSessionLimitError,
} from '../../domain/errors.js';
import {
  type LicensePlanCode,
  type QuotaMetric,
  type TenantLicense,
  buildLicense,
  canCreateResources,
  isWithinLoginHours,
  licenseStatus,
  planForTier,
} from '../../domain/tenant-license.js';
import type { TenantTier } from '../../domain/tenant.js';
import type { LicenseSnapshot } from '../../infrastructure/persistence/tenant-license.repository.js';
import type { TenantLicenseRepository } from '../../infrastructure/persistence/tenant-license.repository.js';

export type LicensePatch = Partial<{
  planCode: LicensePlanCode;
  startsAt: Date;
  expiresAt: Date;
  graceDays: number;
  maxUsers: number;
  maxVehicles: number;
  maxDevices: number;
  maxDrivers: number;
  maxStorageBytes: number;
  maxDownloadBytesMonth: number;
  maxConcurrentSessions: number;
  sessionIdleMinutes: number;
  sessionAbsoluteHours: number;
  loginHoursStart: number | null;
  loginHoursEnd: number | null;
  timezone: string;
  notes: string | null;
  features: Record<string, unknown>;
}>;

@Injectable()
export class TenantEntitlementUseCase {
  constructor(private readonly licenses: TenantLicenseRepository) {}

  public async snapshot(tenantId: string): Promise<LicenseSnapshot | null> {
    return this.licenses.snapshot(tenantId);
  }

  public async requireLicense(tenantId: string): Promise<TenantLicense> {
    const license = await this.licenses.findByTenantId(tenantId);
    if (!license) throw new TenantLicenseExpiredError();
    return license;
  }

  public async assertLoginAllowed(
    tenantId: string,
    concurrentSessions: number,
  ): Promise<TenantLicense> {
    const license = await this.requireLicense(tenantId);
    const status = licenseStatus(license);
    if (status === 'EXPIRED') throw new TenantLicenseExpiredError();
    if (!isWithinLoginHours(license)) throw new TenantLoginWindowError();
    if (concurrentSessions >= license.maxConcurrentSessions) throw new TenantSessionLimitError();
    return license;
  }

  public async assertRefreshAllowed(tenantId: string): Promise<TenantLicense> {
    const license = await this.requireLicense(tenantId);
    if (licenseStatus(license) === 'EXPIRED') throw new TenantLicenseExpiredError();
    return license;
  }

  public async assertCanCreate(tenantId: string, metric: QuotaMetric): Promise<void> {
    const snap = await this.licenses.snapshot(tenantId);
    if (!snap) throw new TenantLicenseExpiredError();
    if (!canCreateResources(snap.license_status)) {
      throw snap.license_status === 'EXPIRED'
        ? new TenantLicenseExpiredError()
        : new TenantQuotaExceededError(metric);
    }
    const meter =
      metric === 'storage_bytes'
        ? snap.quotas.storage_bytes
        : metric === 'download_bytes'
          ? snap.quotas.download_bytes_month
          : snap.quotas[metric];
    if (meter.used >= meter.limit) throw new TenantQuotaExceededError(metric);
  }

  public async provisionFor(
    tenantId: string,
    tier: TenantTier,
    patch?: LicensePatch,
  ): Promise<TenantLicense> {
    const plan = patch?.planCode ?? planForTier(tier);
    const license = buildLicense(tenantId, plan, patch ?? {});
    await this.licenses.insert(license);
    return license;
  }

  public async update(tenantId: string, patch: LicensePatch): Promise<TenantLicense> {
    const current = await this.licenses.findByTenantId(tenantId);
    if (!current) throw new NotFoundError('License');
    const nextPlan = patch.planCode ?? current.planCode;
    const next: TenantLicense = {
      ...current,
      planCode: nextPlan,
      startsAt: patch.startsAt ?? current.startsAt,
      expiresAt: patch.expiresAt ?? current.expiresAt,
      graceDays: patch.graceDays ?? current.graceDays,
      maxUsers: patch.maxUsers ?? current.maxUsers,
      maxVehicles: patch.maxVehicles ?? current.maxVehicles,
      maxDevices: patch.maxDevices ?? current.maxDevices,
      maxDrivers: patch.maxDrivers ?? current.maxDrivers,
      maxStorageBytes: patch.maxStorageBytes ?? current.maxStorageBytes,
      maxDownloadBytesMonth: patch.maxDownloadBytesMonth ?? current.maxDownloadBytesMonth,
      maxConcurrentSessions: patch.maxConcurrentSessions ?? current.maxConcurrentSessions,
      sessionIdleMinutes: patch.sessionIdleMinutes ?? current.sessionIdleMinutes,
      sessionAbsoluteHours: patch.sessionAbsoluteHours ?? current.sessionAbsoluteHours,
      loginHoursStart:
        patch.loginHoursStart === undefined ? current.loginHoursStart : patch.loginHoursStart,
      loginHoursEnd:
        patch.loginHoursEnd === undefined ? current.loginHoursEnd : patch.loginHoursEnd,
      timezone: patch.timezone ?? current.timezone,
      notes: patch.notes === undefined ? current.notes : patch.notes,
      features: patch.features ?? current.features,
    };
    await this.licenses.save(next);
    return next;
  }

  public async setUsage(
    tenantId: string,
    patch: { storageBytes?: number; downloadBytesMonth?: number },
  ): Promise<LicenseSnapshot | null> {
    const existing = await this.licenses.findByTenantId(tenantId);
    if (!existing) throw new NotFoundError('License');
    await this.licenses.setUsage(tenantId, patch);
    return this.licenses.snapshot(tenantId);
  }
}

export function sessionTtlFromLicense(license: TenantLicense): {
  idleSeconds: number;
  absoluteSeconds: number;
} {
  return {
    idleSeconds: Math.max(60, license.sessionIdleMinutes * 60),
    absoluteSeconds: Math.max(3600, license.sessionAbsoluteHours * 3600),
  };
}
