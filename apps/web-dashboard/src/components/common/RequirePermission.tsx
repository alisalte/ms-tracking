/**
 * RequirePermission — route-level functional-area guard (Sprint E §23/§24).
 *
 * Render-only UX gate: when the signed-in user's real permission set (JWT
 * `permissions[]` from GET /auth/me, incl. the `*` admin wildcard) does not
 * satisfy the requirement, the route renders `PermissionDeniedState` INSIDE
 * the authenticated layout (nav stays usable). The backend enforces the same
 * strings on every endpoint — this is never the security boundary.
 *
 * Usage in the router:
 *   { path: '/map', element: <RequirePermission permission="tracking.read"><MapPage /></RequirePermission> }
 */
import type { ReactNode } from 'react';

import { PermissionDeniedState, usePermissions } from '@/auth/permissions';

interface RequirePermissionProps {
  /** Single required permission string (PERMISSIONS.*). */
  permission: string;
  children: ReactNode;
}

export function RequirePermission({ permission, children }: RequirePermissionProps) {
  const { can } = usePermissions();
  if (!can(permission)) return <PermissionDeniedState />;
  return <>{children}</>;
}
