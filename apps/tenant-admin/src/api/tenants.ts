import { api } from '@/api/client';

export type TenantTier = 'STANDARD' | 'PROFESSIONAL' | 'ENTERPRISE';
export type TenantStatus =
  | 'PROVISIONING'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'DEPROVISIONING'
  | 'DEPROVISIONED';

export interface TenantRow {
  id: string;
  name: string;
  tier: TenantTier;
  region: string;
  status: TenantStatus;
  created_at?: string;
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
}): Promise<{ tenant_id: string; admin_user_id: string }> {
  const { data } = await api.post<{ data: { tenant_id: string; admin_user_id: string } }>(
    '/tenants',
    input,
  );
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
