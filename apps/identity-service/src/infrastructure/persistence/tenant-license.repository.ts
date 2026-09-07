/**
 * Tenant license + usage persistence. Platform-scoped (withoutTenantContext)
 * because SaaS-Ops lists every tenant. Live fleet counts are best-effort:
 * missing fleet schema (fresh identity-only DB) returns 0.
 */
import { type Knex, assertUuid } from '@fleetvision/persistence-knex';
import {
  type LicensePlanCode,
  type QuotaMeter,
  type TenantLicense,
  daysRemaining,
  estimateContractTotal,
  licenseStatus,
  quotaLimit,
  quotaMeter,
} from '../../domain/index.js';
import { withoutTenantContext } from './tenant-context.js';

export interface LicenseRow {
  tenant_id: string;
  license_key: string;
  plan_code: LicensePlanCode;
  starts_at: Date;
  expires_at: Date;
  grace_days: number;
  max_users: number;
  max_vehicles: number;
  max_devices: number;
  max_drivers: number;
  max_storage_bytes: string | number;
  max_download_bytes_month: string | number;
  max_concurrent_sessions: number;
  session_idle_minutes: number;
  session_absolute_hours: number;
  login_hours_start: number | null;
  login_hours_end: number | null;
  timezone: string;
  notes: string | null;
  features: Record<string, unknown> | string | null;
  currency?: string;
  base_price?: string | number;
  unit_price_users?: string | number;
  unit_price_vehicles?: string | number;
  unit_price_devices?: string | number;
  unit_price_drivers?: string | number;
  unit_price_storage_gib?: string | number;
  unit_price_download_gib?: string | number;
}

export interface UsageRow {
  tenant_id: string;
  storage_bytes: string | number;
  download_bytes_month: string | number;
  download_period_start: Date;
}

export interface LicenseQuotas {
  users: QuotaMeter;
  vehicles: QuotaMeter;
  devices: QuotaMeter;
  drivers: QuotaMeter;
  storage_bytes: QuotaMeter;
  download_bytes_month: QuotaMeter;
}

export interface LicenseSnapshot {
  license_key: string;
  plan_code: LicensePlanCode;
  starts_at: string;
  expires_at: string;
  grace_days: number;
  license_status: ReturnType<typeof licenseStatus>;
  days_remaining: number;
  notes: string | null;
  timezone: string;
  login_hours_start: number | null;
  login_hours_end: number | null;
  session_idle_minutes: number;
  session_absolute_hours: number;
  max_concurrent_sessions: number;
  features: Record<string, unknown>;
  currency: string;
  base_price: number;
  unit_price_users: number;
  unit_price_vehicles: number;
  unit_price_devices: number;
  unit_price_drivers: number;
  unit_price_storage_gib: number;
  unit_price_download_gib: number;
  estimated_total: number;
  quotas: LicenseQuotas;
}

function num(v: string | number | bigint): number {
  return Number(v);
}

function asFeatures(raw: LicenseRow['features']): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw;
}

export function rowToLicense(row: LicenseRow): TenantLicense {
  return {
    tenantId: row.tenant_id,
    licenseKey: row.license_key,
    planCode: row.plan_code,
    startsAt: new Date(row.starts_at),
    expiresAt: new Date(row.expires_at),
    graceDays: row.grace_days,
    maxUsers: row.max_users,
    maxVehicles: row.max_vehicles,
    maxDevices: row.max_devices,
    maxDrivers: row.max_drivers,
    maxStorageBytes: num(row.max_storage_bytes),
    maxDownloadBytesMonth: num(row.max_download_bytes_month),
    maxConcurrentSessions: row.max_concurrent_sessions,
    sessionIdleMinutes: row.session_idle_minutes,
    sessionAbsoluteHours: row.session_absolute_hours,
    loginHoursStart: row.login_hours_start,
    loginHoursEnd: row.login_hours_end,
    timezone: row.timezone,
    notes: row.notes,
    features: asFeatures(row.features),
    currency: row.currency || 'IRR',
    basePrice: num(row.base_price ?? 0),
    unitPriceUsers: num(row.unit_price_users ?? 0),
    unitPriceVehicles: num(row.unit_price_vehicles ?? 0),
    unitPriceDevices: num(row.unit_price_devices ?? 0),
    unitPriceDrivers: num(row.unit_price_drivers ?? 0),
    unitPriceStorageGib: num(row.unit_price_storage_gib ?? 0),
    unitPriceDownloadGib: num(row.unit_price_download_gib ?? 0),
  };
}

function licenseToRow(license: TenantLicense): Record<string, unknown> {
  return {
    tenant_id: license.tenantId,
    license_key: license.licenseKey,
    plan_code: license.planCode,
    starts_at: license.startsAt,
    expires_at: license.expiresAt,
    grace_days: license.graceDays,
    max_users: license.maxUsers,
    max_vehicles: license.maxVehicles,
    max_devices: license.maxDevices,
    max_drivers: license.maxDrivers,
    max_storage_bytes: license.maxStorageBytes,
    max_download_bytes_month: license.maxDownloadBytesMonth,
    max_concurrent_sessions: license.maxConcurrentSessions,
    session_idle_minutes: license.sessionIdleMinutes,
    session_absolute_hours: license.sessionAbsoluteHours,
    login_hours_start: license.loginHoursStart,
    login_hours_end: license.loginHoursEnd,
    timezone: license.timezone,
    notes: license.notes,
    features: JSON.stringify(license.features),
    currency: license.currency,
    base_price: license.basePrice,
    unit_price_users: license.unitPriceUsers,
    unit_price_vehicles: license.unitPriceVehicles,
    unit_price_devices: license.unitPriceDevices,
    unit_price_drivers: license.unitPriceDrivers,
    unit_price_storage_gib: license.unitPriceStorageGib,
    unit_price_download_gib: license.unitPriceDownloadGib,
    updated_at: new Date(),
  };
}

export class TenantLicenseRepository {
  constructor(private readonly knex: Knex) {}

  public async findByTenantId(tenantId: string): Promise<TenantLicense | null> {
    return withoutTenantContext(this.knex, async (trx) => {
      const row = await trx<LicenseRow>('iam.tenant_licenses')
        .where({ tenant_id: tenantId })
        .first();
      return row ? rowToLicense(row) : null;
    });
  }

  public async insert(license: TenantLicense): Promise<void> {
    await withoutTenantContext(this.knex, async (trx) => {
      await trx('iam.tenant_licenses').insert(licenseToRow(license));
      await trx('iam.tenant_usage')
        .insert({
          tenant_id: license.tenantId,
          storage_bytes: 0,
          download_bytes_month: 0,
          download_period_start: new Date(),
        })
        .onConflict('tenant_id')
        .ignore();
    });
  }

  public async save(license: TenantLicense): Promise<void> {
    await withoutTenantContext(this.knex, async (trx) => {
      const updated = await trx('iam.tenant_licenses')
        .where({ tenant_id: license.tenantId })
        .update(licenseToRow(license));
      if (updated === 0) {
        await trx('iam.tenant_licenses').insert(licenseToRow(license));
      }
    });
  }

  public async setUsage(
    tenantId: string,
    patch: { storageBytes?: number; downloadBytesMonth?: number },
  ): Promise<void> {
    await withoutTenantContext(this.knex, async (trx) => {
      const existing = await trx<UsageRow>('iam.tenant_usage')
        .where({ tenant_id: tenantId })
        .first();
      const next = {
        tenant_id: tenantId,
        storage_bytes: patch.storageBytes ?? (existing ? num(existing.storage_bytes) : 0),
        download_bytes_month:
          patch.downloadBytesMonth ?? (existing ? num(existing.download_bytes_month) : 0),
        download_period_start: existing?.download_period_start ?? new Date(),
        updated_at: new Date(),
      };
      if (!existing) {
        await trx('iam.tenant_usage').insert(next);
        return;
      }
      await trx('iam.tenant_usage').where({ tenant_id: tenantId }).update(next);
    });
  }

  public async snapshot(tenantId: string): Promise<LicenseSnapshot | null> {
    return withoutTenantContext(this.knex, async (trx) => {
      const row = await trx<LicenseRow>('iam.tenant_licenses')
        .where({ tenant_id: tenantId })
        .first();
      if (!row) return null;
      const license = rowToLicense(row);
      const usage = await this.readUsage(trx, tenantId);
      const counts = await this.liveCounts(trx, tenantId);
      return this.toSnapshot(license, counts, usage);
    });
  }

  public async snapshotsFor(tenantIds: readonly string[]): Promise<Map<string, LicenseSnapshot>> {
    if (tenantIds.length === 0) return new Map();
    return withoutTenantContext(this.knex, async (trx) => {
      const rows = await trx<LicenseRow>('iam.tenant_licenses').whereIn('tenant_id', tenantIds);
      const usageRows = await trx<UsageRow>('iam.tenant_usage').whereIn('tenant_id', tenantIds);
      const usageById = new Map(usageRows.map((u) => [u.tenant_id, u]));
      const out = new Map<string, LicenseSnapshot>();
      for (const row of rows) {
        const license = rowToLicense(row);
        const counts = await this.liveCounts(trx, license.tenantId);
        const usage = this.normalizeUsage(usageById.get(license.tenantId), license.tenantId);
        out.set(license.tenantId, this.toSnapshot(license, counts, usage));
      }
      return out;
    });
  }

  public toSnapshot(
    license: TenantLicense,
    counts: { users: number; vehicles: number; devices: number; drivers: number },
    usage: { storageBytes: number; downloadBytesMonth: number },
  ): LicenseSnapshot {
    const status = licenseStatus(license);
    return {
      license_key: license.licenseKey,
      plan_code: license.planCode,
      starts_at: license.startsAt.toISOString(),
      expires_at: license.expiresAt.toISOString(),
      grace_days: license.graceDays,
      license_status: status,
      days_remaining: daysRemaining(license),
      notes: license.notes,
      timezone: license.timezone,
      login_hours_start: license.loginHoursStart,
      login_hours_end: license.loginHoursEnd,
      session_idle_minutes: license.sessionIdleMinutes,
      session_absolute_hours: license.sessionAbsoluteHours,
      max_concurrent_sessions: license.maxConcurrentSessions,
      features: license.features,
      currency: license.currency,
      base_price: license.basePrice,
      unit_price_users: license.unitPriceUsers,
      unit_price_vehicles: license.unitPriceVehicles,
      unit_price_devices: license.unitPriceDevices,
      unit_price_drivers: license.unitPriceDrivers,
      unit_price_storage_gib: license.unitPriceStorageGib,
      unit_price_download_gib: license.unitPriceDownloadGib,
      estimated_total: estimateContractTotal(license),
      quotas: {
        users: quotaMeter(counts.users, quotaLimit(license, 'users')),
        vehicles: quotaMeter(counts.vehicles, quotaLimit(license, 'vehicles')),
        devices: quotaMeter(counts.devices, quotaLimit(license, 'devices')),
        drivers: quotaMeter(counts.drivers, quotaLimit(license, 'drivers')),
        storage_bytes: quotaMeter(usage.storageBytes, quotaLimit(license, 'storage_bytes')),
        download_bytes_month: quotaMeter(
          usage.downloadBytesMonth,
          quotaLimit(license, 'download_bytes'),
        ),
      },
    };
  }

  private async readUsage(
    trx: Knex,
    tenantId: string,
  ): Promise<{ storageBytes: number; downloadBytesMonth: number }> {
    const row = await trx<UsageRow>('iam.tenant_usage').where({ tenant_id: tenantId }).first();
    return this.normalizeUsage(row, tenantId);
  }

  private normalizeUsage(
    row: UsageRow | undefined,
    tenantId: string,
  ): { storageBytes: number; downloadBytesMonth: number } {
    void tenantId;
    if (!row) return { storageBytes: 0, downloadBytesMonth: 0 };
    const start = new Date(row.download_period_start);
    const now = new Date();
    const rolled =
      start.getUTCFullYear() !== now.getUTCFullYear() || start.getUTCMonth() !== now.getUTCMonth();
    return {
      storageBytes: num(row.storage_bytes),
      downloadBytesMonth: rolled ? 0 : num(row.download_bytes_month),
    };
  }

  private async liveCounts(
    trx: Knex,
    tenantId: string,
  ): Promise<{ users: number; vehicles: number; devices: number; drivers: number }> {
    assertUuid(tenantId);
    await trx.raw(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    const users = await countSafe(trx, () =>
      trx('iam.users')
        .where({ tenant_id: tenantId })
        .whereNot({ status: 'DEACTIVATED' })
        .count({ c: '*' })
        .first(),
    );
    const vehicles = await countSafe(trx, () =>
      trx('fleet.vehicles')
        .where({ tenant_id: tenantId, status: 'ACTIVE' })
        .count({ c: '*' })
        .first(),
    );
    const devices = await countSafe(trx, () =>
      trx('fleet.devices')
        .where({ tenant_id: tenantId })
        .whereNot({ status: 'DECOMMISSIONED' })
        .count({ c: '*' })
        .first(),
    );
    const drivers = await countSafe(trx, () =>
      trx('fleet.drivers')
        .where({ tenant_id: tenantId })
        .whereNot({ status: 'TERMINATED' })
        .count({ c: '*' })
        .first(),
    );
    return { users, vehicles, devices, drivers };
  }
}

async function countSafe(
  _trx: Knex,
  run: () => Promise<{ c?: string | number } | undefined>,
): Promise<number> {
  try {
    const row = await run();
    return Number(row?.c ?? 0);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '42P01' || code === '42501') return 0;
    throw err;
  }
}
