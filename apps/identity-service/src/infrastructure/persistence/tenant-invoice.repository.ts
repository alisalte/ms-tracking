/**
 * Tenant invoices — platform-scoped (withoutTenantContext) for SaaS-Ops.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from '@fleetvision/persistence-knex';
import {
  type InvoiceDraft,
  type InvoiceLine,
  type InvoiceStatus,
  effectiveInvoiceStatus,
  formatInvoiceNumber,
} from '../../domain/tenant-invoice.js';
import { withoutTenantContext } from './tenant-context.js';

export interface InvoiceRecord {
  id: string;
  tenant_id: string;
  tenant_name?: string;
  invoice_number: string;
  status: InvoiceStatus;
  period_start: string;
  period_end: string;
  due_date: string;
  currency: string;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
  notes: string | null;
  generated_at: string;
  paid_at: string | null;
  voided_at: string | null;
  lines: Array<{
    type: InvoiceLine['type'];
    description: string;
    quantity: number;
    unit_price: number;
    total_amount: number;
  }>;
}

interface InvoiceRow {
  id: string;
  tenant_id: string;
  tenant_name?: string;
  invoice_number: string;
  status: InvoiceStatus;
  period_start: Date;
  period_end: Date;
  due_date: Date;
  currency: string;
  subtotal: string | number;
  tax_rate: string | number;
  tax_amount: string | number;
  total_amount: string | number;
  notes: string | null;
  generated_at: Date;
  paid_at: Date | null;
  voided_at: Date | null;
}

interface LineRow {
  invoice_id: string;
  line_no: number;
  type: InvoiceLine['type'];
  description: string;
  quantity: string | number;
  unit_price: string | number;
  total_amount: string | number;
}

function num(v: string | number | bigint | null | undefined): number {
  return Number(v ?? 0);
}

function toRecord(row: InvoiceRow, lines: InvoiceLine[], now = new Date()): InvoiceRecord {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    tenant_name: row.tenant_name,
    invoice_number: row.invoice_number,
    status: effectiveInvoiceStatus(row.status, new Date(row.due_date), now),
    period_start: new Date(row.period_start).toISOString(),
    period_end: new Date(row.period_end).toISOString(),
    due_date: new Date(row.due_date).toISOString(),
    currency: row.currency,
    subtotal: num(row.subtotal),
    tax_rate: num(row.tax_rate),
    tax_amount: num(row.tax_amount),
    total_amount: num(row.total_amount),
    notes: row.notes,
    generated_at: new Date(row.generated_at).toISOString(),
    paid_at: row.paid_at ? new Date(row.paid_at).toISOString() : null,
    voided_at: row.voided_at ? new Date(row.voided_at).toISOString() : null,
    lines: lines.map((line) => ({
      type: line.type,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      total_amount: line.totalAmount,
    })),
  };
}

function toLine(row: LineRow): InvoiceLine {
  return {
    type: row.type,
    description: row.description,
    quantity: num(row.quantity),
    unitPrice: num(row.unit_price),
    totalAmount: num(row.total_amount),
  };
}

export class TenantInvoiceRepository {
  constructor(private readonly knex: Knex) {}

  public async findById(id: string): Promise<InvoiceRecord | null> {
    return withoutTenantContext(this.knex, async (trx) => {
      const row = await trx<InvoiceRow>('iam.tenant_invoices as i')
        .leftJoin('iam.tenants as t', 't.id', 'i.tenant_id')
        .select('i.*', 't.name as tenant_name')
        .where('i.id', id)
        .first();
      if (!row) return null;
      const lines = await trx<LineRow>('iam.tenant_invoice_lines')
        .where({ invoice_id: id })
        .orderBy('line_no');
      return toRecord(row, lines.map(toLine));
    });
  }

  public async list(tenantId?: string): Promise<InvoiceRecord[]> {
    return withoutTenantContext(this.knex, async (trx) => {
      let q = trx<InvoiceRow>('iam.tenant_invoices as i')
        .leftJoin('iam.tenants as t', 't.id', 'i.tenant_id')
        .select('i.*', 't.name as tenant_name')
        .orderBy('i.generated_at', 'desc');
      if (tenantId) q = q.where('i.tenant_id', tenantId);
      const rows = await q;
      const ids = rows.map((r) => r.id);
      const lines =
        ids.length === 0
          ? []
          : await trx<LineRow>('iam.tenant_invoice_lines')
              .whereIn('invoice_id', ids)
              .orderBy('line_no');
      const byInvoice = new Map<string, InvoiceLine[]>();
      for (const line of lines) {
        const list = byInvoice.get(line.invoice_id) ?? [];
        list.push(toLine(line));
        byInvoice.set(line.invoice_id, list);
      }
      return rows.map((row) => toRecord(row, byInvoice.get(row.id) ?? []));
    });
  }

  public async findOpenForPeriod(
    tenantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<InvoiceRecord | null> {
    return withoutTenantContext(this.knex, async (trx) => {
      const row = await trx<InvoiceRow>('iam.tenant_invoices')
        .where({ tenant_id: tenantId })
        .whereNot({ status: 'VOID' })
        .andWhere('period_start', periodStart)
        .andWhere('period_end', periodEnd)
        .first();
      if (!row) return null;
      return toRecord(row, []);
    });
  }

  public async insert(draft: InvoiceDraft): Promise<InvoiceRecord> {
    const id = randomUUID();
    const year = (draft.periodEnd ?? new Date()).getUTCFullYear();
    return withoutTenantContext(this.knex, async (trx) => {
      const seqRow = await trx('iam.tenant_invoices')
        .whereRaw('invoice_number like ?', [`INV-${year}-%`])
        .count({ c: '*' })
        .first();
      const seq = Number(seqRow?.c ?? 0) + 1;
      const invoiceNumber = formatInvoiceNumber(year, seq);
      const now = new Date();
      await trx('iam.tenant_invoices').insert({
        id,
        tenant_id: draft.tenantId,
        invoice_number: invoiceNumber,
        status: 'ISSUED',
        period_start: draft.periodStart,
        period_end: draft.periodEnd,
        due_date: draft.dueDate,
        currency: draft.currency,
        subtotal: draft.totals.subtotal,
        tax_rate: draft.taxRate,
        tax_amount: draft.totals.taxAmount,
        total_amount: draft.totals.totalAmount,
        notes: draft.notes,
        generated_at: now,
      });
      if (draft.lines.length > 0) {
        await trx('iam.tenant_invoice_lines').insert(
          draft.lines.map((line, i) => ({
            id: randomUUID(),
            invoice_id: id,
            line_no: i + 1,
            type: line.type,
            description: line.description,
            quantity: line.quantity,
            unit_price: line.unitPrice,
            total_amount: line.totalAmount,
          })),
        );
      }
      const saved = await trx<InvoiceRow>('iam.tenant_invoices as i')
        .leftJoin('iam.tenants as t', 't.id', 'i.tenant_id')
        .select('i.*', 't.name as tenant_name')
        .where('i.id', id)
        .first();
      if (!saved) throw new Error('Invoice insert failed');
      return toRecord(saved, [...draft.lines], now);
    });
  }

  public async markPaid(id: string): Promise<InvoiceRecord | null> {
    return withoutTenantContext(this.knex, async (trx) => {
      const updated = await trx('iam.tenant_invoices')
        .where({ id, status: 'ISSUED' })
        .orWhere({ id, status: 'OVERDUE' })
        .update({ status: 'PAID', paid_at: new Date() });
      if (updated === 0) {
        const row = await trx<InvoiceRow>('iam.tenant_invoices').where({ id }).first();
        if (!row) return null;
        if (row.status === 'PAID') {
          const lines = await trx<LineRow>('iam.tenant_invoice_lines').where({ invoice_id: id });
          return toRecord(row, lines.map(toLine));
        }
        return null;
      }
      return this.findById(id);
    });
  }

  public async void(id: string): Promise<InvoiceRecord | null> {
    return withoutTenantContext(this.knex, async (trx) => {
      const updated = await trx('iam.tenant_invoices')
        .where({ id })
        .whereIn('status', ['ISSUED', 'OVERDUE'])
        .update({ status: 'VOID', voided_at: new Date() });
      if (updated === 0) return null;
      return this.findById(id);
    });
  }
}
