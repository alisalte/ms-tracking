const ACCESS = 'ta_access';
const REFRESH = 'ta_refresh';
const TENANT = 'ta_tenant';
const TENANT_NAME = 'ta_tenant_name';
const PERMS = 'ta_perms';

export interface Session {
  accessToken: string;
  refreshToken: string;
  tenantId: string;
  tenantName: string;
  permissions: string[];
}

export function loadSession(): Session | null {
  const accessToken = localStorage.getItem(ACCESS);
  const refreshToken = localStorage.getItem(REFRESH);
  const tenantId = localStorage.getItem(TENANT);
  const tenantName = localStorage.getItem(TENANT_NAME);
  const permissionsRaw = localStorage.getItem(PERMS);
  if (!accessToken || !refreshToken || !tenantId) return null;
  let permissions: string[] = [];
  try {
    permissions = permissionsRaw ? (JSON.parse(permissionsRaw) as string[]) : [];
  } catch {
    permissions = [];
  }
  return { accessToken, refreshToken, tenantId, tenantName: tenantName ?? '', permissions };
}

export function saveSession(s: Session): void {
  localStorage.setItem(ACCESS, s.accessToken);
  localStorage.setItem(REFRESH, s.refreshToken);
  localStorage.setItem(TENANT, s.tenantId);
  localStorage.setItem(TENANT_NAME, s.tenantName);
  localStorage.setItem(PERMS, JSON.stringify(s.permissions));
}

export function clearSession(): void {
  localStorage.removeItem(ACCESS);
  localStorage.removeItem(REFRESH);
  localStorage.removeItem(TENANT);
  localStorage.removeItem(TENANT_NAME);
  localStorage.removeItem(PERMS);
}

export function canManageTenants(permissions: readonly string[]): boolean {
  return permissions.includes('*') || permissions.includes('billing.tenant.manage');
}
