/**
 * Re-export of the shared permissions guard + decorator (Sprint B). RBAC is now
 * owned by `@fleetvision/auth` so every service enforces the same model. This
 * shim keeps existing import paths (`../shared/permissions.guard.js`) compiling.
 */
export {
  PermissionsGuard,
  RequirePermissions,
  PERMISSIONS_KEY,
} from '@fleetvision/auth';
