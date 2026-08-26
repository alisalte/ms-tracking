import axios, { type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';

import { getStoredTokens, getTenantId } from '@/auth/token.storage';
import type { ApiResponse } from '@/types/api.types';
import { normalizeApiError } from './errors';
import { refreshTokensSingleFlight } from './token-refresh';

/**
 * Pre-configured Axios instance for FleetVision API calls.
 *
 * - Base URL from VITE_API_BASE_URL (default: /api/v1)
 * - Request interceptor: attaches Bearer token + X-Tenant-Id header
 * - Response interceptor: unwraps { data: T } envelope, handles errors
 *
 * All token persistence goes through the typed `token.storage` helpers so the
 * client never touches localStorage keys directly (single source of truth).
 */
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  timeout: 30_000,
});

/**
 * Queue to prevent multiple token refresh attempts when several 401s arrive
 * simultaneously. The actual rotation lives in `token-refresh.ts` — the app's
 * SINGLE flight path, shared with the silent refresh and the auth store, so
 * two racing refreshes can never replay a rotated token (which revoked the
 * token family and logged users out).
 */

/**
 * Request interceptor: attach Authorization and X-Tenant-Id headers.
 */
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const stored = getStoredTokens();
  const isLogin = typeof config.url === 'string' && config.url.includes('/auth/login');

  // Login is public. A leftover session after a DB re-seed would otherwise
  // attach a dead JWT *and* its stale tenant UUID, which identity treats as
  // "Invalid credentials" even when the form has the live org name.
  if (stored?.accessToken && !isLogin) {
    config.headers.set('Authorization', `Bearer ${stored.accessToken}`);
  }
  if (isLogin) {
    config.headers.delete('Authorization');
  }

  // Prefer a header already set on this request (the login form). Otherwise
  // fall back to the stored session tenant, then the standalone key.
  if (!config.headers.get('X-Tenant-Id')) {
    const tenantId = isLogin ? getTenantId() : (stored?.tenantId ?? getTenantId());
    if (tenantId) {
      config.headers.set('X-Tenant-Id', tenantId);
    }
  }
  return config;
});

/**
 * Response interceptor: unwrap envelope, handle 401 with token refresh.
 */
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as
      | (InternalAxiosRequestConfig & { _retry?: boolean })
      | undefined;

    // No request config to retry — fall through to error extraction.
    if (originalRequest) {
      // Don't retry login/refresh endpoints
      const isAuthEndpoint =
        originalRequest.url?.includes('/auth/login') ||
        originalRequest.url?.includes('/auth/refresh');

      if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
        originalRequest._retry = true;

        // App-wide single-flight rotation (shared with the silent refresh).
        const tokens = await refreshTokensSingleFlight();
        if (tokens) {
          originalRequest.headers.Authorization = `Bearer ${tokens.accessToken}`;
          return apiClient(originalRequest);
        }

        // Refresh failed — redirect to login
        window.location.href = '/login';
        return Promise.reject(error);
      }
    }

    // Normalize every non-2xx response into a typed ApiClientError subclass.
    return Promise.reject(normalizeApiError(error));
  },
);

/**
 * Typed GET request that unwraps the { data: T } envelope.
 */
export async function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const response = await apiClient.get<ApiResponse<T>>(url, { params });
  return response.data.data;
}

/**
 * Typed GET for endpoints that return a RAW body (no { data } envelope) —
 * gps-engine REST (`/positions/*`, `/tracking/devices/*`) responds unwrapped.
 */
export async function apiGetRaw<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const response = await apiClient.get<T>(url, { params });
  return response.data;
}

/**
 * Typed POST for endpoints that return a RAW body (no { data } envelope) —
 * map-engine REST (`/route/match`, `/location/*`) responds unwrapped.
 */
export async function apiPostRaw<TRes>(url: string, body?: unknown): Promise<TRes> {
  const response = await apiClient.post<TRes>(url, body);
  return response.data;
}

/**
 * Typed PUT for endpoints that return a RAW body (no { data } envelope) —
 * map-engine REST (`/geofences/*`) responds unwrapped.
 */
export async function apiPutRaw<TRes>(url: string, body?: unknown): Promise<TRes> {
  const response = await apiClient.put<TRes>(url, body);
  return response.data;
}

/**
 * Typed POST request that unwraps the { data: T } envelope.
 */
export async function apiPost<TReq, TRes>(
  url: string,
  body?: TReq,
  config?: AxiosRequestConfig,
): Promise<TRes> {
  const response = await apiClient.post<ApiResponse<TRes>>(url, body, config);
  return response.data.data;
}

/**
 * Typed POST request for endpoints that return no body (e.g. 204 No Content).
 */
export async function apiPostNoContent(url: string, body?: unknown): Promise<void> {
  await apiClient.post(url, body);
}

/**
 * Blob GET for file downloads (CSV export) — authenticated like every other
 * request; the caller saves the Blob via downloadBlob().
 */
export async function apiGetBlob(url: string, params?: Record<string, unknown>): Promise<Blob> {
  const response = await apiClient.get<Blob>(url, { params, responseType: 'blob' });
  return response.data;
}

/**
 * Typed DELETE request that unwraps the { data: T } envelope.
 */
export async function apiDelete<T = void>(url: string): Promise<T> {
  const response = await apiClient.delete<ApiResponse<T>>(url);
  return response.data.data;
}

/**
 * Typed DELETE for endpoints that return no body (204 — archive/unbind/decommission).
 */
export async function apiDeleteNoContent(url: string): Promise<void> {
  await apiClient.delete(url);
}

/**
 * Typed PUT request that unwraps the { data: T } envelope.
 */
export async function apiPut<TReq, TRes>(url: string, body?: TReq): Promise<TRes> {
  const response = await apiClient.put<ApiResponse<TRes>>(url, body);
  return response.data.data;
}

/**
 * Typed PATCH request that unwraps the { data: T } envelope — fleet-management
 * uses PATCH for fleet/vehicle/device updates.
 */
export async function apiPatch<TReq, TRes>(url: string, body?: TReq): Promise<TRes> {
  const response = await apiClient.patch<ApiResponse<TRes>>(url, body);
  return response.data.data;
}

export { apiClient };
