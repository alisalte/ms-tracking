import axios, { type InternalAxiosRequestConfig } from 'axios';

import { clearSession, loadSession, saveSession } from '@/lib/session';

function needsPercentEncode(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 127) return true;
  }
  return false;
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  timeout: 30_000,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const session = loadSession();
  const isLogin = typeof config.url === 'string' && config.url.includes('/auth/login');
  if (session?.accessToken && !isLogin) {
    config.headers.set('Authorization', `Bearer ${session.accessToken}`);
  }
  if (isLogin) config.headers.delete('Authorization');
  const existingTenant = config.headers.get('X-Tenant-Id') as string | null;
  if (existingTenant && needsPercentEncode(existingTenant)) {
    config.headers.set('X-Tenant-Id', encodeURIComponent(existingTenant));
  } else if (!existingTenant) {
    const tenant = session?.tenantId;
    if (tenant) {
      config.headers.set(
        'X-Tenant-Id',
        needsPercentEncode(tenant) ? encodeURIComponent(tenant) : tenant,
      );
    }
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config as
      | (InternalAxiosRequestConfig & { _retry?: boolean })
      | undefined;
    const status = error.response?.status as number | undefined;
    if (!original || status !== 401 || original._retry) {
      return Promise.reject(error);
    }
    const url = original.url ?? '';
    if (url.includes('/auth/login') || url.includes('/auth/refresh')) {
      return Promise.reject(error);
    }
    const session = loadSession();
    if (!session) return Promise.reject(error);
    original._retry = true;
    try {
      const { data } = await axios.post<{
        data: { access_token: string; refresh_token: string };
      }>(
        '/api/v1/auth/refresh',
        { refresh_token: session.refreshToken },
        { headers: { 'X-Tenant-Id': session.tenantId } },
      );
      saveSession({
        ...session,
        accessToken: data.data.access_token,
        refreshToken: data.data.refresh_token,
      });
      original.headers.set('Authorization', `Bearer ${data.data.access_token}`);
      return api.request(original);
    } catch {
      clearSession();
      return Promise.reject(error);
    }
  },
);

export function apiMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const payload = err.response?.data as { errors?: Array<{ detail?: string }>; message?: string };
    return payload?.errors?.[0]?.detail ?? payload?.message ?? err.message;
  }
  return err instanceof Error ? err.message : 'Request failed';
}
