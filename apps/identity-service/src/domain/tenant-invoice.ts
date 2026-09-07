/**
 * Tenant invoice — contract lines from a license, totals, and status.
 * Pure domain: persistence lives in TenantInvoiceRepository.
 */
import { GIB, type TenantLicense } from './tenant-license.js';

export type InvoiceStatus = 'ISSUED' | 'PAID' | 'VOID' | 'OVERDUE';
export type InvoiceLineType =
  | 'PLAN'
  | 'USERS'
  | 'VEHICLES'
  | 'DEVICES'
  | 'DRIVERS'
  | 'STORAGE'
  | 'DOWNLOAD';

export interface InvoiceLine {
  readonly type: InvoiceLineType;
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly totalAmount: number;
}

export interface InvoiceTotals {
  readonly subtotal: number;
  readonly taxAmount: number;
  readonly totalAmount: number;
}

export interface InvoiceDraft {
  readonly tenantId: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly dueDate: Date;
  readonly currency: string;
  readonly taxRate: number;
  readonly notes: string | null;
  readonly lines: readonly InvoiceLine[];
  readonly totals: InvoiceTotals;
}

export function bytesToGib(bytes: number): number {
  return Math.max(0, Math.round((bytes / GIB) * 100) / 100);
}

export function lineTotal(quantity: number, unitPrice: number): number {
  return Math.round(quantity * unitPrice);
}

export function invoiceTotals(lines: readonly InvoiceLine[], taxRate = 0): InvoiceTotals {
  const subtotal = lines.reduce((sum, line) => sum + line.totalAmount, 0);
  const rate = Number.isFinite(taxRate) ? Math.max(0, Math.min(1, taxRate)) : 0;
  const taxAmount = Math.round(subtotal * rate);
  return { subtotal, taxAmount, totalAmount: subtotal + taxAmount };
}

export function contractLines(license: TenantLicense): InvoiceLine[] {
  const storageGib = bytesToGib(license.maxStorageBytes);
  const downloadGib = bytesToGib(license.maxDownloadBytesMonth);
  const rows: Array<{
    type: InvoiceLineType;
    description: string;
    quantity: number;
    unitPrice: number;
  }> = [
    {
      type: 'PLAN',
      description: `Plan ${license.planCode}`,
      quantity: 1,
      unitPrice: license.basePrice,
    },
    {
      type: 'VEHICLES',
      description: 'Vehicles',
      quantity: license.maxVehicles,
      unitPrice: license.unitPriceVehicles,
    },
    {
      type: 'USERS',
      description: 'Users',
      quantity: license.maxUsers,
      unitPrice: license.unitPriceUsers,
    },
    {
      type: 'DEVICES',
      description: 'Devices',
      quantity: license.maxDevices,
      unitPrice: license.unitPriceDevices,
    },
    {
      type: 'DRIVERS',
      description: 'Personnel',
      quantity: license.maxDrivers,
      unitPrice: license.unitPriceDrivers,
    },
    {
      type: 'STORAGE',
      description: 'Storage (GiB)',
      quantity: storageGib,
      unitPrice: license.unitPriceStorageGib,
    },
    {
      type: 'DOWNLOAD',
      description: 'Monthly download (GiB)',
      quantity: downloadGib,
      unitPrice: license.unitPriceDownloadGib,
    },
  ];
  return rows.map((row) => ({
    ...row,
    totalAmount: lineTotal(row.quantity, row.unitPrice),
  }));
}

export function estimateContractTotal(license: TenantLicense, taxRate = 0): number {
  return invoiceTotals(contractLines(license), taxRate).totalAmount;
}

export function buildInvoiceDraft(
  license: TenantLicense,
  opts: { dueDays?: number; taxRate?: number; notes?: string | null; now?: Date } = {},
): InvoiceDraft {
  const now = opts.now ?? new Date();
  const dueDays = opts.dueDays ?? 30;
  const taxRate = opts.taxRate ?? 0;
  const lines = contractLines(license);
  return {
    tenantId: license.tenantId,
    periodStart: license.startsAt,
    periodEnd: license.expiresAt,
    dueDate: new Date(now.getTime() + dueDays * 24 * 60 * 60 * 1000),
    currency: license.currency || 'IRR',
    taxRate,
    notes: opts.notes ?? null,
    lines,
    totals: invoiceTotals(lines, taxRate),
  };
}

export function effectiveInvoiceStatus(
  status: InvoiceStatus,
  dueDate: Date,
  now = new Date(),
): InvoiceStatus {
  if (status === 'ISSUED' && dueDate.getTime() < now.getTime()) return 'OVERDUE';
  return status;
}

export function formatInvoiceNumber(year: number, seq: number): string {
  return `INV-${year}-${String(seq).padStart(6, '0')}`;
}
