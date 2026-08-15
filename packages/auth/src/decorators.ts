/**
 * Auth decorators. `@Public()` exempts a route from the global auth guard
 * (health, login, refresh). `@RequirePermissions(...)` gates a route by RBAC.
 * Both are consumed by the CompositeAuthGuard / PermissionsGuard.
 *
 * `@Public()` and `IS_PUBLIC_KEY` are owned by `@fleetvision/web` so lightweight
 * HTTP packages (health) can declare public routes without depending on the full
 * auth package; re-exported here for the single-import ergonomics most services
 * want (`import { Public, RequirePermissions } from '@fleetvision/auth'`).
 */
import { SetMetadata } from '@nestjs/common';
export { Public, IS_PUBLIC_KEY } from '@fleetvision/web';

/** Metadata key carrying the permissions a route requires. */
export const PERMISSIONS_KEY = 'requiredPermissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
