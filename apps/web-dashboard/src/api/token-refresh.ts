import axios from 'axios';

import { clearTokens, getStoredTokens, saveTokens } from '@/auth/token.storage';
import type { ApiResponse } from '@/types/api.types';
import type { RefreshResponseWire, TokenPair } from '@/types/auth.types';

/**
 * Token refresh — the app's SINGLE flight path for access-token rotation.
 *
 * Why this module exists: two independent refresh paths (the axios 401
 * interceptor and the auth store's silent refresh) once raced each other. One
 * path rotated the refresh token while the other still held the pre-rotation
 * copy; the replay of an already-rotated token tripped identity-service's
 * reuse detection and REVOKED the whole token family — logging the user out
 * every ~15 minutes ("Token is invalid or expired").
 *
 * Contract:
 * - ONE module-level in-flight promise: every caller (interceptor, silent
 *   refresh, store action) shares the same request.
 * - The refresh token is read from token.storage (localStorage) — the single
 *   source of truth — never from a possibly-stale store copy.
 * - On success the new pair is persisted FIRST, then subscribers (the Zustand
 *   store) are notified so their state can never drift from storage.
 * - On failure tokens are cleared and subscribers are notified with null.
 */

type RefreshListener = (tokens: TokenPair | null) => void;

const listeners = new Set<RefreshListener>();

let refreshPromise: Promise<TokenPair | null> | null = null;

/** Bare axios instance — deliberately NO interceptors (no refresh recursion). */
const bareAxios = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  timeout: 30_000,
});

/** Subscribe to token rotations (and failure → null). Returns unsubscribe. */
export function subscribeTokensRefreshed(listener: RefreshListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(tokens: TokenPair | null): void {
  for (const listener of listeners) {
    try {
      listener(tokens);
    } catch {
      /* listener errors must never break the rotation */
    }
  }
}

/**
 * Rotate the token pair — single-flight across the whole app.
 * Resolves with the new pair, or null when no refresh token exists / the
 * refresh was rejected (tokens cleared, session over).
 */
export function refreshTokensSingleFlight(): Promise<TokenPair | null> {
  if (refreshPromise) return refreshPromise;

  const stored = getStoredTokens();
  if (!stored?.refreshToken) {
    return Promise.resolve(null);
  }

  refreshPromise = (async () => {
    try {
      const response = await bareAxios.post<ApiResponse<RefreshResponseWire>>(
        '/auth/refresh',
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
      notify(tokens);
      return tokens;
    } catch {
      clearTokens();
      notify(null);
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}
