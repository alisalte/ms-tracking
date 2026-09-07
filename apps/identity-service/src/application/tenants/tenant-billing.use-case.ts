/**
 * Tenant billing — generate invoices from license prices, list, void, pay,
 * dashboard and report snapshots.
 */
import { Injectable } from '@nestjs/common';
import {
  InvoiceAlreadyIssuedError,
  InvoiceIllegalStatusError,
  NotFoundError,
} from '../../domain/errors.js';
import { buildInvoiceDraft } from '../../domain/tenant-invoice.js';
import type { TenantInvoiceRepository } from '../../infrastructure/persistence/tenant-invoice.repository.js';
import type { LicenseSnapshot } from '../../infrastructure/persistence/tenant-license.repository.js';
import type { TenantLicenseRepository } from '../../infrastructure/persistence/tenant-license.repository.js';
import type { TenantRepository } from '../../infrastructure/persistence/tenant.repository.js';

export interface GenerateInvoiceInput {
  readonly dueDays?: number;
  readonly taxRate?: number;
  readonly notes?: string | null;
}

@Injectable()
export class TenantBillingUseCase {
  constructor(
    private readonly invoices: TenantInvoiceRepository,
    private readonly licenses: TenantLicenseRepository,
    private readonly tenants: TenantRepository,
  ) {}

  public async generate(tenantId: string, input: GenerateInvoiceInput = {}) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) throw new NotFoundError('Tenant');
    const license = await this.licenses.findByTenantId(tenantId);
    if (!license) throw new NotFoundError('License');
    const existing = await this.invoices.findOpenForPeriod(
      tenantId,
      license.startsAt,
      license.expiresAt,
    );
    if (existing) throw new InvoiceAlreadyIssuedError();
    const draft = buildInvoiceDraft(license, {
      dueDays: input.dueDays,
      taxRate: input.taxRate,
      notes: input.notes,
    });
    return this.invoices.insert(draft);
  }

  public async list(tenantId?: string) {
    return this.invoices.list(tenantId);
  }

  public async get(id: string) {
    const invoice = await this.invoices.findById(id);
    if (!invoice) throw new NotFoundError('Invoice');
    return invoice;
  }

  public async markPaid(id: string) {
    const current = await this.invoices.findById(id);
    if (!current) throw new NotFoundError('Invoice');
    if (current.status === 'VOID') throw new InvoiceIllegalStatusError(current.status);
    if (current.status === 'PAID') return current;
    const next = await this.invoices.markPaid(id);
    if (!next) throw new InvoiceIllegalStatusError(current.status);
    return next;
  }

  public async void(id: string) {
    const current = await this.invoices.findById(id);
    if (!current) throw new NotFoundError('Invoice');
    if (current.status === 'PAID' || current.status === 'VOID') {
      throw new InvoiceIllegalStatusError(current.status);
    }
    const next = await this.invoices.void(id);
    if (!next) throw new InvoiceIllegalStatusError(current.status);
    return next;
  }

  public async dashboard() {
    const tenants = await this.tenants.list();
    const snaps = await this.licenses.snapshotsFor(tenants.map((r) => r.tenant.id as string));
    const invoices = await this.invoices.list();
    return buildDashboard(
      tenants.map((r) => ({
        id: r.tenant.id as string,
        name: r.tenant.name,
        status: r.tenant.status,
        license: snaps.get(r.tenant.id as string) ?? null,
      })),
      invoices,
    );
  }

  public async report() {
    const dash = await this.dashboard();
    return dash;
  }
}

export function buildDashboard(
  tenants: Array<{
    id: string;
    name: string;
    status: string;
    license: LicenseSnapshot | null;
  }>,
  invoices: Array<{
    tenant_id: string;
    tenant_name?: string;
    status: string;
    total_amount: number;
    currency: string;
    invoice_number: string;
    generated_at: string;
    period_end: string;
  }>,
) {
  const tenantStatus = { ACTIVE: 0, SUSPENDED: 0, OTHER: 0 };
  const licenseStatus = { ACTIVE: 0, GRACE: 0, EXPIRED: 0, NONE: 0 };
  const byPlan: Record<string, { count: number; contracted: number }> = {};
  let contracted = 0;
  let expiringSoon = 0;
  const tenantRows = tenants.map((t) => {
    if (t.status === 'ACTIVE') tenantStatus.ACTIVE += 1;
    else if (t.status === 'SUSPENDED') tenantStatus.SUSPENDED += 1;
    else tenantStatus.OTHER += 1;
    const plan = t.license?.plan_code ?? 'NONE';
    const estimate = t.license?.estimated_total ?? 0;
    contracted += estimate;
    if (!byPlan[plan]) byPlan[plan] = { count: 0, contracted: 0 };
    byPlan[plan].count += 1;
    byPlan[plan].contracted += estimate;
    if (t.license) {
      licenseStatus[t.license.license_status] += 1;
      if (t.license.days_remaining >= 0 && t.license.days_remaining <= 30) expiringSoon += 1;
    } else {
      licenseStatus.NONE += 1;
    }
    const tenantInvoices = invoices.filter((i) => i.tenant_id === t.id);
    const invoiced = tenantInvoices
      .filter((i) => i.status !== 'VOID')
      .reduce((s, i) => s + i.total_amount, 0);
    const unpaid = tenantInvoices
      .filter((i) => i.status === 'ISSUED' || i.status === 'OVERDUE')
      .reduce((s, i) => s + i.total_amount, 0);
    return {
      tenant_id: t.id,
      name: t.name,
      status: t.status,
      plan_code: t.license?.plan_code ?? null,
      license_status: t.license?.license_status ?? null,
      days_remaining: t.license?.days_remaining ?? null,
      contracted: estimate,
      invoiced,
      unpaid,
      currency: t.license?.currency ?? 'IRR',
    };
  });

  const invoiceStatus = { ISSUED: 0, PAID: 0, VOID: 0, OVERDUE: 0 };
  let collected = 0;
  let outstanding = 0;
  for (const inv of invoices) {
    invoiceStatus[inv.status as keyof typeof invoiceStatus] += 1;
    if (inv.status === 'PAID') collected += inv.total_amount;
    if (inv.status === 'ISSUED' || inv.status === 'OVERDUE') outstanding += inv.total_amount;
  }

  tenantRows.sort((a, b) => b.contracted - a.contracted);

  return {
    kpis: {
      tenants: tenants.length,
      tenants_active: tenantStatus.ACTIVE,
      tenants_suspended: tenantStatus.SUSPENDED,
      licenses_active: licenseStatus.ACTIVE,
      licenses_grace: licenseStatus.GRACE,
      licenses_expired: licenseStatus.EXPIRED,
      expiring_soon: expiringSoon,
      contracted,
      invoiced_collected: collected,
      invoiced_outstanding: outstanding,
      invoices_issued: invoiceStatus.ISSUED + invoiceStatus.OVERDUE + invoiceStatus.PAID,
      currency: 'IRR',
    },
    tenant_status: tenantStatus,
    license_status: licenseStatus,
    invoice_status: invoiceStatus,
    by_plan: Object.entries(byPlan).map(([plan_code, v]) => ({ plan_code, ...v })),
    tenants: tenantRows,
    recent_invoices: invoices.slice(0, 12),
  };
}
