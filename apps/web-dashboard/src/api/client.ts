import axios, { type InternalAxiosRequestConfig } from 'axios';

import { clearTokens, getStoredTokens, getTenantId, saveTokens } from '@/auth/token.storage';
import type { ApiResponse } from '@/types/api.types';
import type { RefreshResponseWire, TokenPair } from '@/types/auth.types';
import { normalizeApiError } from './errors';

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
 * simultaneously.
 */
let refreshPromise: Promise<string | null> | null = null;

/**
 * Attempt to refresh the access token using the stored refresh token.
 * The refresh endpoint returns snake_case on the wire; we map it to the
 * camelCase `TokenPair` we persist.
 */
async function refreshAccessToken(): Promise<string | null> {
  const stored = getStoredTokens();
  if (!stored?.refreshToken) return null;

  try {
    const response = await axios.post<ApiResponse<RefreshResponseWire>>(
      `${apiClient.defaults.baseURL}/auth/refresh`,
      { refresh_token: stored.refreshToken },
      { headers: { 'X-Tenant-Id': stored.tenantId } },
    );

    const wire = response.data.data;
    const tokens: TokenPair = {
      accessToken: wire.access_token,
      refreshToken: wire.refresh_token,
      tenantId: stored.tenantId,
    };
    saveTokens(tokens);

    return tokens.accessToken;
  } catch {
    // Refresh failed — clear tokens
    clearTokens();
    return null;
  }
}

/**
 * Request interceptor: attach Authorization and X-Tenant-Id headers.
 */
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const stored = getStoredTokens();
  if (stored?.accessToken) {
    config.headers.set('Authorization', `Bearer ${stored.accessToken}`);
  }
  // Tenant ID: prefer the token pair, fall back to the standalone key so the
  // header is present on the login request itself (tokens don't exist yet).
  const tenantId = stored?.tenantId ?? getTenantId();
  if (tenantId) {
    config.headers.set('X-Tenant-Id', tenantId);
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

        // Use shared refresh promise to prevent concurrent refreshes
        if (!refreshPromise) {
          refreshPromise = refreshAccessToken().finally(() => {
            refreshPromise = null;
          });
        }

        const newToken = await refreshPromise;
        if (newToken) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
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
 * Typed POST request that unwraps the { data: T } envelope.
 */
export async function apiPost<TReq, TRes>(url: string, body?: TReq): Promise<TRes> {
  const response = await apiClient.post<ApiResponse<TRes>>(url, body);
  return response.data.data;
}

/**
 * Typed POST request for endpoints that return no body (e.g. 204 No Content).
 */
export async function apiPostNoContent(url: string, body?: unknown): Promise<void> {
  await apiClient.post(url, body);
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
