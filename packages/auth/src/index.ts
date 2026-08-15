/**
 * @fleetvision/auth — public surface.
 *
 * The single source of truth for authentication & authorization across the
 * platform. identity-service and every downstream service import this so no
 * service implements its own auth (Codebase Architecture §10).
 */
// Config
export { authConfigSchema, type AuthConfig } from './auth-config.js';

// Permission catalog
export {
  Permissions,
  type Permission,
  IamPermissions,
  WILDCARD_PERMISSION,
  ALL_PERMISSIONS,
  permissionSatisfies,
  SYSTEM_ROLES,
  type SystemRoleSeed,
} from './permission-catalog.js';

// Authenticated context
export {
  type AuthenticatedContext,
  type Principal,
  getAuthContext,
  getPrincipal,
} from './authenticated-context.js';

// Token claims
export type { AccessTokenClaims, VerifiedAccessToken } from './token-claims.js';

// Errors
export {
  TokenInvalidError,
  PermissionDeniedError,
  TenantAccessDeniedError,
  ApiKeyInvalidError,
} from './errors.js';

// Decorators
export {
  IS_PUBLIC_KEY,
  Public,
  PERMISSIONS_KEY,
  RequirePermissions,
} from './decorators.js';
export { CurrentUser, CurrentTenant } from './param-decorators.js';

// Guards + module
export { CompositeAuthGuard } from './composite-auth.guard.js';
export { PermissionsGuard } from './permissions.guard.js';
export { AuthModule, type AuthModuleOptions } from './auth.module.js';
// Union alias (parallel line naming): services from the merged line wire
// AuthCoreModule.forRoot(...) — identical to AuthModule.forRoot.
export { AuthModule as AuthCoreModule } from './auth.module.js';
export { AUTH_OPTIONS_TOKEN, type AuthGuardOptions } from './tokens.js';

// Revocation + API-key verification (re-exported for direct construction/tests)
export { RevocationStore } from './revocation-store.js';
export {
  ApiKeyVerifier,
  KnexApiKeyVerifier,
  type VerifiedApiKey,
} from './api-key-verifier.js';

// Credential helper (for WebSocket handshake reuse)
export { extractCredential, type ExtractedCredential, type CredentialKind } from './credentials.js';

// --- Sprint-D merge union: the origin line's composable auth primitives ---
// The JwtAuthGuard path lets services apply `@UseGuards(JwtAuthGuard)` with an
// injected TokenVerifier (used by apps/fleet-service + apps/notification-service).
// Local's global CompositeAuthGuard remains the primary enforcement path.
export { JwtAuthGuard, type JwtAuthGuardDeps } from './jwt-auth.guard.js';
export { jwtAuthGuardProvider } from './jwt-auth-guard.provider.js';
export { SharedJwtVerifier, type SharedJwtVerifierConfig } from './shared-jwt-verifier.js';
export type {
  TokenVerifier,
  VerifiedToken,
  RevocationChecker,
  PermissionResolver,
} from './token-verifier.port.js';
export { ZodValidationPipe } from './zod-validation.pipe.js';
export {
  uuidParamSchema,
  pageRequestSchema,
  datetimeQuerySchema,
  type UuidParamDto,
  type PageRequestDto,
} from './validation-schemas.js';
export {
  TOKEN_VERIFIER,
  REVOCATION_CHECKER,
  PERMISSION_RESOLVER,
  JWT_AUTH_GUARD,
} from './tokens.js';
