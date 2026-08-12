/**
 * Permissions guard + decorator — re-exported from @fleetvision/auth so identity
 * keeps a single import path. The shared guard throws PermissionDeniedError (from
 * @fleetvision/auth), which identity's domain/errors.ts also exports under the
 * same name+code (FORBIDDEN→403); the GlobalExceptionFilter maps it correctly.
 *
 * OPA is the authoritative evaluator in production (cached 5s); this is the
 * in-process fallback used until OPA lands (docs/specs/02 §6).
 */
export {
  PermissionsGuard,
  RequirePermissions,
  PERMISSIONS_KEY,
} from '@fleetvision/auth';
