import { api } from '@/api/client';

export interface TenantEmailSettings {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  hasPassword: boolean;
  fromAddress: string;
  updatedAt: string;
}

export interface TenantEmailSettingsState {
  settings: TenantEmailSettings | null;
  encryptionAvailable: boolean;
}

export interface SaveTenantEmailSettings {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  /** Omit to keep the stored password; '' clears it. */
  password?: string;
  fromAddress: string;
}

const path = (tenantId: string) => `/platform/tenants/${tenantId}/report-email`;

export async function getTenantEmailSettings(tenantId: string): Promise<TenantEmailSettingsState> {
  const { data } = await api.get<{ data: TenantEmailSettingsState }>(path(tenantId));
  return data.data;
}

export async function saveTenantEmailSettings(
  tenantId: string,
  body: SaveTenantEmailSettings,
): Promise<TenantEmailSettings> {
  const { data } = await api.put<{ data: TenantEmailSettings }>(path(tenantId), body);
  return data.data;
}

export async function deleteTenantEmailSettings(tenantId: string): Promise<void> {
  await api.delete(path(tenantId));
}

export async function sendTenantEmailTest(tenantId: string, to: string): Promise<void> {
  await api.post(`${path(tenantId)}/test`, { to });
}
