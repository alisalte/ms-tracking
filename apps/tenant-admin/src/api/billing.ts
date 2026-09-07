import { api } from '@/api/client';

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
  type: InvoiceLineType;
  description: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
}

export interface Invoice {
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
  lines: InvoiceLine[];
}

export interface BillingDashboard {
  kpis: {
    tenants: number;
    tenants_active: number;
    tenants_suspended: number;
    licenses_active: number;
    licenses_grace: number;
    licenses_expired: number;
    expiring_soon: number;
    contracted: number;
    invoiced_collected: number;
    invoiced_outstanding: number;
    invoices_issued: number;
    currency: string;
  };
  tenant_status: { ACTIVE: number; SUSPENDED: number; OTHER: number };
  license_status: { ACTIVE: number; GRACE: number; EXPIRED: number; NONE: number };
  invoice_status: { ISSUED: number; PAID: number; VOID: number; OVERDUE: number };
  by_plan: Array<{ plan_code: string; count: number; contracted: number }>;
  tenants: Array<{
    tenant_id: string;
    name: string;
    status: string;
    plan_code: string | null;
    license_status: string | null;
    days_remaining: number | null;
    contracted: number;
    invoiced: number;
    unpaid: number;
    currency: string;
  }>;
  recent_invoices: Invoice[];
}

export async function getDashboard(): Promise<BillingDashboard> {
  const { data } = await api.get<{ data: BillingDashboard }>('/billing/dashboard');
  return data.data;
}

export async function getReport(): Promise<BillingDashboard> {
  const { data } = await api.get<{ data: BillingDashboard }>('/billing/report');
  return data.data;
}

export async function listInvoices(tenantId?: string): Promise<Invoice[]> {
  const path = tenantId ? `/tenants/${tenantId}/invoices` : '/billing/invoices';
  const { data } = await api.get<{ data: Invoice[] }>(path);
  return data.data;
}

export async function getInvoice(id: string): Promise<Invoice> {
  const { data } = await api.get<{ data: Invoice }>(`/billing/invoices/${id}`);
  return data.data;
}

export async function generateInvoice(
  tenantId: string,
  input: { due_days?: number; tax_rate?: number; notes?: string | null } = {},
): Promise<Invoice> {
  const { data } = await api.post<{ data: Invoice }>(`/tenants/${tenantId}/invoices`, input);
  return data.data;
}

export async function payInvoice(id: string): Promise<Invoice> {
  const { data } = await api.post<{ data: Invoice }>(`/billing/invoices/${id}/pay`);
  return data.data;
}

export async function voidInvoice(id: string): Promise<Invoice> {
  const { data } = await api.post<{ data: Invoice }>(`/billing/invoices/${id}/void`);
  return data.data;
}
