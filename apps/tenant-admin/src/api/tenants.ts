import { api } from '@/api/client';

export type TenantTier = 'STANDARD' | 'PROFESSIONAL' | 'ENTERPRISE';
export type TenantStatus =
  | 'PROVISIONING'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'DEPROVISIONING'
  | 'DEPROVISIONED';
export type LicensePlanCode = 'TRIAL' | 'STANDARD' | 'PROFESSIONAL' | 'ENTERPRISE' | 'CUSTOM';
export type LicenseStatus = 'ACTIVE' | 'GRACE' | 'EXPIRED';
export type QuotaState = 'ok' | 'warn' | 'exceeded';

export interface QuotaMeter {
  used: number;
  limit: number;
  pct: number;
  state: QuotaState;
}

export interface TenantLicense {
  license_key: string;
  plan_code: LicensePlanCode;
  starts_at: string;
  expires_at: string;
  grace_days: number;
  license_status: LicenseStatus;
  days_remaining: number;
  notes: string | null;
  timezone: string;
  login_hours_start: number | null;
  login_hours_end: number | null;
  session_idle_minutes: number;
  session_absolute_hours: number;
  max_concurrent_sessions: number;
  features: Record<string, unknown>;
  quotas: {
    users: QuotaMeter;
    vehicles: QuotaMeter;
    devices: QuotaMeter;
    drivers: QuotaMeter;
    storage_bytes: QuotaMeter;
    download_bytes_month: QuotaMeter;
  };
}

export interface TenantRow {
  id: string;
  name: string;
  tier: TenantTier;
  region: string;
  status: TenantStatus;
  created_at?: string;
  license?: TenantLicense | null;
}

export interface TenantUser {
  id: string;
  tenant_id: string;
  email: string;
  username: string;
  status: string;
  display_name: string | null;
  roles: string[];
  last_login_at: string | null;
}

export interface LicenseFields {
  plan_code?: LicensePlanCode;
  starts_at?: string;
  expires_at?: string;
  grace_days?: number;
  max_users?: number;
  max_vehicles?: number;
  max_devices?: number;
  max_drivers?: number;
  max_storage_bytes?: number;
  max_download_bytes_month?: number;
  max_concurrent_sessions?: number;
  session_idle_minutes?: number;
  session_absolute_hours?: number;
  login_hours_start?: number | null;
  login_hours_end?: number | null;
  timezone?: string;
  notes?: string | null;
}

export async function listTenants(): Promise<TenantRow[]> {
  const { data } = await api.get<{ data: TenantRow[] }>('/tenants');
  return data.data;
}

export async function getTenant(id: string): Promise<TenantRow | null> {
  const { data } = await api.get<{ data: TenantRow | null }>(`/tenants/${id}`);
  return data.data;
}

export async function provisionTenant(input: {
  name: string;
  tier: TenantTier;
  region: string;
  admin_email: string;
  admin_username: string;
  admin_password: string;
  license?: LicenseFields;
}): Promise<{ tenant_id: string; admin_user_id: string }> {
  const { data } = await api.post<{ data: { tenant_id: string; admin_user_id: string } }>(
    '/tenants',
    input,
  );
  return data.data;
}

export async function updateTenantLicense(id: string, input: LicenseFields): Promise<TenantRow> {
  const { data } = await api.put<{ data: TenantRow }>(`/tenants/${id}/license`, input);
  return data.data;
}

export async function updateTenantUsage(
  id: string,
  input: { storage_bytes?: number; download_bytes_month?: number },
): Promise<TenantRow> {
  const { data } = await api.post<{ data: TenantRow }>(`/tenants/${id}/usage`, input);
  return data.data;
}

export async function suspendTenant(id: string): Promise<TenantRow> {
  const { data } = await api.post<{ data: TenantRow }>(`/tenants/${id}/suspend`);
  return data.data;
}

export async function reactivateTenant(id: string): Promise<TenantRow> {
  const { data } = await api.post<{ data: TenantRow }>(`/tenants/${id}/reactivate`);
  return data.data;
}

export async function listTenantUsers(id: string): Promise<TenantUser[]> {
  const { data } = await api.get<{ data: TenantUser[] }>(`/tenants/${id}/users`);
  return data.data;
}

export async function createTenantUser(
  tenantId: string,
  input: {
    email: string;
    username: string;
    password: string;
    display_name?: string;
    role_name: 'tenant-admin' | 'fleet-admin' | 'viewer';
  },
): Promise<void> {
  await api.post(`/tenants/${tenantId}/users`, input);
}

export async function setTenantUserStatus(
  tenantId: string,
  userId: string,
  status: 'active' | 'suspended',
): Promise<void> {
  await api.patch(`/tenants/${tenantId}/users/${userId}/status`, { status });
}
