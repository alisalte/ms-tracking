/**
 * useCurrentUser — the centralized current-principal accessor (Phase 3).
 *
 * One hook exposes the full session identity for the UI: user, tenant, roles,
 * and permissions, plus derived helpers. It is a thin, memo-safe view over the
 * auth store (the single source of truth — nothing is duplicated or
 * re-fetched); existing consumers (`usePermissions`, `useAuth`) keep working.
 *
 * Security posture (unchanged): everything here is presentation metadata from
 * `GET /auth/me` (JWT claims). Frontend gating is UX only — the backend
 * remains the authorization authority on every endpoint.
 */
import { useAuthStore } from '@/auth/auth.store';
import { permissionSatisfies, permissionsSatisfy } from '@/auth/permissions';

/** Stable empty arrays — avoid per-snapshot allocations (re-render loop guard). */
const NO_ROLES: readonly string[] = [];
const NO_PERMISSIONS: readonly string[] = [];

export interface CurrentUser {
  /** Signed-in profile (null until /auth/me resolves). */
  user: ReturnType<typeof useAuthStore.getState>['user'];
  /** Active tenant id (the X-Tenant-Id the API layer sends). */
  tenantId: string | null;
  roles: readonly string[];
  permissions: readonly string[];
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Session error message surfaced by the store (login failures etc.). */
  error: string | null;
  /** `true` while permissions are still loading after login (seeded empty). */
  permissionsPending: boolean;
}

export function useCurrentUser(): CurrentUser & {
  can: (permission: string) => boolean;
  canAll: (permissions: readonly string[]) => boolean;
  canAny: (permissions: readonly string[]) => boolean;
} {
  const user = useAuthStore((s) => s.user);
  const tenantId = useAuthStore((s) => s.tenantId);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);

  const roles = user?.roles ?? NO_ROLES;
  const permissions = user?.permissions ?? NO_PERMISSIONS;

  return {
    user,
    tenantId,
    roles,
    permissions,
    isAuthenticated,
    isLoading,
    error,
    // Authenticated but profile (permissions[]) not yet fetched — gates should
    // not flash "denied" during this window.
    permissionsPending: isAuthenticated && user === null,
    can: (required: string) => permissionSatisfies(permissions, required),
    canAll: (required: readonly string[]) => permissionsSatisfy(permissions, required),
    canAny: (required: readonly string[]) =>
      required.some((p) => permissionSatisfies(permissions, p)),
  };
}
