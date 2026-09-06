import { api } from '@/api/client';
import { canManageTenants, saveSession } from '@/lib/session';

interface LoginEnvelope {
  data: {
    access_token: string;
    refresh_token: string;
    user: { id: string; email: string; tenant_id: string; tenant_name: string; roles: string[] };
  };
}

interface MeEnvelope {
  data: { permissions?: string[] };
}

export class ForbiddenTenantAdminError extends Error {
  constructor() {
    super('FORBIDDEN');
    this.name = 'ForbiddenTenantAdminError';
  }
}

export async function login(tenantName: string, email: string, password: string): Promise<void> {
  const { data } = await api.post<LoginEnvelope>(
    '/auth/login',
    { email, password },
    { headers: { 'X-Tenant-Id': encodeURIComponent(tenantName) } },
  );
  saveSession({
    accessToken: data.data.access_token,
    refreshToken: data.data.refresh_token,
    tenantId: data.data.user.tenant_id,
    tenantName: data.data.user.tenant_name,
    permissions: [],
  });
  const me = await api.get<MeEnvelope>('/auth/me');
  const permissions = me.data.data.permissions ?? [];
  saveSession({
    accessToken: data.data.access_token,
    refreshToken: data.data.refresh_token,
    tenantId: data.data.user.tenant_id,
    tenantName: data.data.user.tenant_name,
    permissions,
  });
  if (!canManageTenants(permissions)) {
    throw new ForbiddenTenantAdminError();
  }
}
