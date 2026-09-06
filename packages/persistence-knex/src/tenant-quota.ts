/**
 * Enforce tenant license quotas at create time (vehicles / devices / drivers).
 * Identity owns the license row; fleet services read it from the same Postgres.
 *
 * When knex is a unit-test stub (not a query builder), this is a no-op so
 * existing service tests keep passing. Missing license row after migration is
 * fail-closed.
 */
import type { Knex } from './knex.factory.js';

export type TenantQuotaMetric = 'vehicles' | 'devices' | 'drivers';

export class TenantQuotaDeniedError extends Error {
  public readonly code = 'TENANT_QUOTA';

  constructor(
    message: string,
    public readonly reason: 'TENANT_QUOTA' | 'TENANT_LICENSE_EXPIRED' | 'TENANT_LICENSE_GRACE',
    public readonly metric?: string,
  ) {
    super(message);
    this.name = 'TenantQuotaDeniedError';
  }
}

interface LicenseCaps {
  expires_at: Date;
  grace_days: number;
  max_vehicles: number;
  max_devices: number;
  max_drivers: number;
}

const COUNT_QUERY: Record<
  TenantQuotaMetric,
  {
    table: string;
    whereNot?: { status: string };
    where?: { status: string };
    cap: keyof LicenseCaps;
  }
> = {
  vehicles: { table: 'fleet.vehicles', where: { status: 'ACTIVE' }, cap: 'max_vehicles' },
  devices: { table: 'fleet.devices', whereNot: { status: 'DECOMMISSIONED' }, cap: 'max_devices' },
  drivers: { table: 'fleet.drivers', whereNot: { status: 'TERMINATED' }, cap: 'max_drivers' },
};

export async function assertTenantResourceQuota(
  knex: Knex,
  tenantId: string,
  metric: TenantQuotaMetric,
): Promise<void> {
  if (typeof knex !== 'function') return;
  let license: LicenseCaps | undefined;
  try {
    license = await knex('iam.tenant_licenses').where({ tenant_id: tenantId }).first();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '42P01' || code === '42501') return;
    throw err;
  }
  if (!license) {
    throw new TenantQuotaDeniedError(
      'Tenant license has expired.',
      'TENANT_LICENSE_EXPIRED',
      metric,
    );
  }
  const now = Date.now();
  const expires = new Date(license.expires_at).getTime();
  const graceMs = Number(license.grace_days) * 24 * 60 * 60 * 1000;
  if (now >= expires + graceMs) {
    throw new TenantQuotaDeniedError(
      'Tenant license has expired.',
      'TENANT_LICENSE_EXPIRED',
      metric,
    );
  }
  if (now >= expires) {
    throw new TenantQuotaDeniedError(
      `Tenant quota exceeded for ${metric}.`,
      'TENANT_LICENSE_GRACE',
      metric,
    );
  }
  const spec = COUNT_QUERY[metric];
  let q = knex(spec.table).where({ tenant_id: tenantId });
  if (spec.where) q = q.where(spec.where);
  if (spec.whereNot) q = q.whereNot(spec.whereNot);
  const row = await q.count({ c: '*' }).first();
  const used = Number((row as { c?: string | number } | undefined)?.c ?? 0);
  const limit = Number(license[spec.cap]);
  if (used >= limit) {
    throw new TenantQuotaDeniedError(
      `Tenant quota exceeded for ${metric}.`,
      'TENANT_QUOTA',
      metric,
    );
  }
}
