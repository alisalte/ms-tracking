import { describe, expect, it } from '@jest/globals';
import { buildDashboard } from '../application/tenants/tenant-billing.use-case.js';
import {
  buildInvoiceDraft,
  contractLines,
  estimateContractTotal,
  formatInvoiceNumber,
  invoiceTotals,
} from '../domain/tenant-invoice.js';
import { buildLicense } from '../domain/tenant-license.js';

describe('tenant invoice domain', () => {
  const license = buildLicense('t1', 'STANDARD', {
    startsAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2026-12-31T00:00:00Z'),
    maxVehicles: 10,
    maxUsers: 2,
    maxDevices: 10,
    maxDrivers: 5,
    basePrice: 1_000_000,
    unitPriceVehicles: 100_000,
    unitPriceUsers: 50_000,
    unitPriceDevices: 10_000,
    unitPriceDrivers: 20_000,
    unitPriceStorageGib: 1_000,
    unitPriceDownloadGib: 500,
  });

  it('prices every rented resource on the contract', () => {
    const lines = contractLines(license);
    expect(lines.map((l) => l.type)).toEqual([
      'PLAN',
      'VEHICLES',
      'USERS',
      'DEVICES',
      'DRIVERS',
      'STORAGE',
      'DOWNLOAD',
    ]);
    expect(lines.find((l) => l.type === 'VEHICLES')?.totalAmount).toBe(1_000_000);
    expect(lines.find((l) => l.type === 'USERS')?.totalAmount).toBe(100_000);
  });

  it('sums line items and optional tax', () => {
    const totals = invoiceTotals(contractLines(license), 0.09);
    const net = estimateContractTotal(license);
    expect(totals.subtotal).toBe(net);
    expect(totals.taxAmount).toBe(Math.round(net * 0.09));
    expect(totals.totalAmount).toBe(net + totals.taxAmount);
  });

  it('drafts an invoice for the license period', () => {
    const draft = buildInvoiceDraft(license, {
      dueDays: 15,
      now: new Date('2026-09-01T00:00:00Z'),
    });
    expect(draft.periodStart.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(draft.dueDate.toISOString()).toBe('2026-09-16T00:00:00.000Z');
    expect(draft.currency).toBe('IRR');
    expect(draft.totals.totalAmount).toBeGreaterThan(0);
  });

  it('formats sequential invoice numbers', () => {
    expect(formatInvoiceNumber(2026, 12)).toBe('INV-2026-000012');
  });
});

describe('billing dashboard snapshot', () => {
  it('rolls up contracted value and outstanding invoices', () => {
    const dash = buildDashboard(
      [
        {
          id: 't1',
          name: 'Acme',
          status: 'ACTIVE',
          license: {
            plan_code: 'STANDARD',
            license_status: 'ACTIVE',
            days_remaining: 12,
            estimated_total: 5_000_000,
            currency: 'IRR',
          } as never,
        },
        {
          id: 't2',
          name: 'Beta',
          status: 'SUSPENDED',
          license: {
            plan_code: 'TRIAL',
            license_status: 'EXPIRED',
            days_remaining: -3,
            estimated_total: 0,
            currency: 'IRR',
          } as never,
        },
      ],
      [
        {
          tenant_id: 't1',
          status: 'ISSUED',
          total_amount: 5_000_000,
          currency: 'IRR',
          invoice_number: 'INV-2026-000001',
          generated_at: '2026-09-01T00:00:00Z',
          period_end: '2026-12-31T00:00:00Z',
        },
      ],
    );
    expect(dash.kpis.tenants).toBe(2);
    expect(dash.kpis.tenants_active).toBe(1);
    expect(dash.kpis.expiring_soon).toBe(1);
    expect(dash.kpis.contracted).toBe(5_000_000);
    expect(dash.kpis.invoiced_outstanding).toBe(5_000_000);
    expect(dash.tenants[0]?.unpaid).toBe(5_000_000);
  });
});
