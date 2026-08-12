/**
 * @fleetvision/auth — public surface.
 *
 * The shared, repo-agnostic authentication primitives used by every backend
 * service to trust identity-issued HS256 JWTs. Identity-service keeps its own
 * richer implementations and re-exports these where convenient.
 */
export { AuthCoreModule, type AuthCoreModuleOptions } from './auth.module.js';
export {
  JwtAuthGuard,
  type JwtAuthGuardDeps,
} from './jwt-auth.guard.js';
export { jwtAuthGuardProvider } from './jwt-auth-guard.provider.js';
export {
  SharedJwtVerifier,
  type SharedJwtVerifierConfig,
} from './shared-jwt-verifier.js';
export type {
  TokenVerifier,
  VerifiedToken,
  AccessTokenClaims,
  RevocationChecker,
  PermissionResolver,
} from './token-verifier.port.js';
export { type Principal, getPrincipal } from './principal.js';
export {
  PermissionsGuard,
  RequirePermissions,
  PERMISSIONS_KEY,
  permissionSatisfies,
} from './permissions.guard.js';
export { ZodValidationPipe } from './zod-validation.pipe.js';
export {
  uuidParamSchema,
  pageRequestSchema,
  datetimeQuerySchema,
  type UuidParamDto,
  type PageRequestDto,
} from './validation-schemas.js';
export { PermissionDeniedError, UnauthenticatedError } from './errors.js';
export {
  TOKEN_VERIFIER,
  REVOCATION_CHECKER,
  PERMISSION_RESOLVER,
  JWT_AUTH_GUARD,
} from './tokens.js';
