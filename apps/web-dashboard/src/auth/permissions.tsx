import { ShieldAlert } from 'lucide-react';
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
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '@/auth/auth.store';
import { EmptyState } from '@/components/tailwind-ui';

/** The permission strings the UI gates on (must match the backend catalog). */
export const PERMISSIONS = {
  fleetRead: 'fleet.read',
  fleetWrite: 'fleet.write',
  vehicleRead: 'vehicle.read',
  vehicleWrite: 'vehicle.write',
  deviceRead: 'device.read',
  deviceWrite: 'device.write',
  driverRead: 'fleet.driver.read',
  driverCreate: 'fleet.driver.create',
  driverWrite: 'fleet.driver.update',
  driverManage: 'fleet.driver.manage',
  trackingRead: 'tracking.read',
  // Sprint I — geofence management (map-engine; reused Sprint F permission names).
  mapsRead: 'maps.read',
  mapsWrite: 'maps.write',
  // Sprint J — reporting & analytics (reporting-service).
  reportRead: 'report.read',
  reportExport: 'report.export',
  // Sprint G — alarm/event engine (notification-service).
  alertRead: 'notification.alert.read',
  alertAck: 'notification.alert.ack',
  alertResolve: 'notification.alert.resolve',
  ruleRead: 'notification.rule.read',
  ruleCreate: 'notification.rule.create',
  ruleWrite: 'notification.rule.update',
  eventRead: 'notification.event.read',
  // Sprint H — notification center.
  notificationRead: 'notification.read',
  notificationReadAll: 'notification.read.all',
  notificationPreferenceRead: 'notification.preference.read',
  notificationPreferenceWrite: 'notification.preference.write',
  // Device commands (telemetry.command.* — 02 §6.1; fleet-management enforces).
  commandRead: 'telemetry.command.read',
  commandSend: 'telemetry.command.send',
} as const;

/** Does the granted set (incl. the `*` wildcard) satisfy one requirement? */
export function permissionSatisfies(granted: readonly string[], required: string): boolean {
  return granted.includes('*') || granted.includes(required);
}

/** Do the granted sets satisfy EVERY requirement (backend = AND semantics)? */
export function permissionsSatisfy(
  granted: readonly string[],
  required: readonly string[],
): boolean {
  return required.every((r) => permissionSatisfies(granted, r));
}

/**
 * `can(permission)` / `canAll([...])` against the signed-in user's real
 * permissions. Unauthenticated → nothing is granted.
 */
/** Stable empty-set — `?? []` in the selector would allocate a new array per
 * snapshot and trip React's useSyncExternalStore loop guard (infinite
 * re-render when the user is signed out). */
const NO_PERMISSIONS: readonly string[] = [];

export function usePermissions() {
  const permissions = useAuthStore((s) => s.user?.permissions ?? NO_PERMISSIONS);
  return {
    permissions,
    can: (required: string) => permissionSatisfies(permissions, required),
    canAll: (required: readonly string[]) => permissionsSatisfy(permissions, required),
    canAny: (required: readonly string[]) =>
      required.some((p) => permissionSatisfies(permissions, p)),
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
      icon={<ShieldAlert />}
      title={t('errors.permissionDeniedTitle', 'Permission denied')}
      description={hint ?? t('errors.permissionDeniedBody', 'You do not have access to this area.')}
    />
  );
}
