import { create } from 'zustand';

import * as loginApi from '@/api/auth.api';
import { refreshTokensSingleFlight, subscribeTokensRefreshed } from '@/api/token-refresh';
import type { User } from '@/types/auth.types';
import { clearTokens, getStoredTokens, saveTenantId, saveTokens } from './token.storage';

/**
 * Synchronously hydrate from localStorage on store creation.
 *
 * Without this, a page refresh races the `ProtectedRoute` (which reads the
 * initial state on the very first render) against `AuthProvider`'s async
 * `useEffect` hydration — so the guard sees `accessToken: null` and bounces to
 * /login before the stored tokens are loaded. Reading localStorage
 * synchronously in the initial state closes that race.
 */
function readInitialAuth() {
  const stored = getStoredTokens();
  if (!stored) {
    return { accessToken: null, refreshToken: null, tenantId: null, isAuthenticated: false };
  }
  return {
    accessToken: stored.accessToken,
    refreshToken: stored.refreshToken,
    tenantId: stored.tenantId,
    isAuthenticated: Boolean(stored.accessToken),
  };
}

/** Auth store state. */
interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  tenantId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

/** Auth store actions. */
interface AuthActions {
  /** Login with email + password. Stores tokens and fetches user profile.
   *  Resolves `true` on success, `false` on failure (error also in state). */
  login: (email: string, password: string, tenantId: string) => Promise<boolean>;
  /** Exchange the stored refresh token for a new access token. */
  refreshTokens: () => Promise<void>;
  /** Fetch the current user profile from /me. */
  fetchUser: () => Promise<void>;
  /** Logout: revoke tokens server-side and clear local state. */
  logout: () => Promise<void>;
  /** Set tokens from storage (e.g. on app init from localStorage). */
  hydrate: (
    accessToken: string | null,
    refreshToken: string | null,
    tenantId: string | null,
  ) => void;
  /** Clear any auth error. */
  clearError: () => void;
}

export type AuthStore = AuthState & AuthActions;

/**
 * Zustand auth store.
 *
 * Manages authentication state: tokens, user profile, and loading/error states.
 * Actions call the auth API layer and persist tokens via token.storage.
 */
export const useAuthStore = create<AuthStore>((set) => ({
  // State — synchronously hydrated from localStorage so a page refresh doesn't
  // bounce through /login before the stored session is restored.
  ...readInitialAuth(),
  user: null,
  isLoading: false,
  error: null,
  // Actions
  login: async (email, password, tenantId) => {
    set({ isLoading: true, error: null });
    try {
      saveTenantId(tenantId);
      const response = await loginApi.login(email, password);

      // Persist tokens. Sprint I E2E fix: the login form accepts a tenant
      // NAME ("FleetVision") — persist the server-resolved canonical UUID from
      // the login response instead. The axios interceptor sends the stored
      // value as X-Tenant-Id on every call, and identity's tenant-mismatch
      // guard (Sprint B) 403s a name that differs from the token's tenant.
      const canonicalTenantId = response.user.tenantId ?? tenantId;
      saveTokens({
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        tenantId: canonicalTenantId,
      });
      saveTenantId(canonicalTenantId);

      set({
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        tenantId: canonicalTenantId,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        // Populate user from login response
        user: {
          id: response.user.id,
          email: response.user.email,
          tenantId: response.user.tenantId,
          roles: response.user.roles,
          permissions: [],
        },
      });

      // Fetch full user profile (with permissions). The backend `/auth/me`
      // returns the real user email (fixed in Sprint 1); the fallback to the
      // login response email is kept as a safety net.
      try {
        const fullUser = await loginApi.getMe();
        set({
          user: {
            ...fullUser,
            email: fullUser.email || response.user.email,
          },
        });
      } catch {
        // Non-critical: login succeeded, user profile fetch failed
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed. Please try again.';
      set({ isLoading: false, error: message, isAuthenticated: false });
      clearTokens();
      return false;
    }
  },

  refreshTokens: async () => {
    // Route through the app-wide single-flight rotation (shared with the axios
    // 401 interceptor). A store-local refresh once raced the interceptor's,
    // replaying an already-rotated refresh token — identity's reuse detection
    // revoked the token family and forced a logout every ~15 min.
    const tokens = await refreshTokensSingleFlight();
    if (!tokens) {
      set({
        accessToken: null,
        refreshToken: null,
        user: null,
        tenantId: null,
        isAuthenticated: false,
      });
    }
    // Success case is handled by the subscription below (keeps store == storage).
  },

  fetchUser: async () => {
    try {
      const user = await loginApi.getMe();
      set({ user, isAuthenticated: true });
    } catch {
      set({ user: null, isAuthenticated: false });
    }
  },

  logout: async () => {
    try {
      await loginApi.logout();
    } catch {
      // Logout API call failed — still clear local state
    }
    set({
      accessToken: null,
      refreshToken: null,
      user: null,
      tenantId: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
    clearTokens();
  },

  hydrate: (accessToken, refreshToken, tenantId) => {
    set({
      accessToken,
      refreshToken,
      tenantId,
      isAuthenticated: !!accessToken,
    });
  },

  clearError: () => {
    set({ error: null });
  },
}));

// Keep the store in lockstep with every token rotation driven by the shared
// single-flight path (axios 401 interceptor / silent refresh): storage is the
// source of truth, the store mirrors it. A null rotation = session over.
subscribeTokensRefreshed((tokens) => {
  if (tokens) {
    useAuthStore.setState({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  } else {
    useAuthStore.setState({
      accessToken: null,
      refreshToken: null,
      user: null,
      tenantId: null,
      isAuthenticated: false,
    });
  }
});
