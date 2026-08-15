/**
 * Permission-aware UI (Sprint E §23/§24).
 *
 * `User.permissions` comes from the REAL backend identity (`GET /auth/me` —
 * the JWT's `permissions[]` claim). Frontend gating is UX ONLY: hiding a
 * button is a convenience, never a security boundary — the backend guards
 * every endpoint with the same permission strings (`fleet.read`, `vehicle.write`, …).
 *
 * `*` is the tenant-admin wildcard (identity's WILDCARD_PERMISSION) and
 * satisfies any requirement, mirroring the backend's permissionSatisfies().
 */
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '@/auth/auth.store';
import { EmptyState } from '@/components/ui';
import { ShieldAlert } from 'lucide-react';

/** The permission strings the UI gates on (must match the backend catalog). */
export const PERMISSIONS = {
  fleetRead: 'fleet.read',
  fleetWrite: 'fleet.write',
  vehicleRead: 'vehicle.read',
  vehicleWrite: 'vehicle.write',
  deviceRead: 'device.read',
  deviceWrite: 'device.write',
  trackingRead: 'tracking.read',
} as const;

/** Does the granted set (incl. the `*` wildcard) satisfy one requirement? */
export function permissionSatisfies(granted: readonly string[], required: string): boolean {
  return granted.includes('*') || granted.includes(required);
}

/** Do the granted sets satisfy EVERY requirement (backend = AND semantics)? */
export function permissionsSatisfy(granted: readonly string[], required: readonly string[]): boolean {
  return required.every((r) => permissionSatisfies(granted, r));
}

/**
 * `can(permission)` / `canAll([...])` against the signed-in user's real
 * permissions. Unauthenticated → nothing is granted.
 */
export function usePermissions() {
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  return {
    permissions,
    can: (required: string) => permissionSatisfies(permissions, required),
    canAll: (required: readonly string[]) => permissionsSatisfy(permissions, required),
  };
}

/**
 * Render children only when the caller holds the permission(s); otherwise
 * render `fallback` (default: nothing). For buttons/toolbars.
 */
export function PermissionGate({
  requires,
  any = false,
  fallback = null,
  children,
}: {
  requires: string | readonly string[];
  /** true = satisfy ANY one requirement (default: ALL, matching the backend). */
  any?: boolean;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const { can, canAll } = usePermissions();
  const list = typeof requires === 'string' ? [requires] : requires;
  const allowed = any ? list.some((p) => can(p)) : canAll(list);
  return <>{allowed ? children : fallback}</>;
}

/**
 * Full-page "permission denied" state for routes the user cannot enter at all.
 */
export function PermissionDeniedState({ hint }: { hint?: string }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={ShieldAlert}
      title={t('errors.permissionDeniedTitle', 'Permission denied')}
      description={
        hint ?? t('errors.permissionDeniedBody', 'You do not have access to this area.')
      }
    />
  );
}
