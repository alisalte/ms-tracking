/**
 * Token-verifier port — the service-side abstraction over JWT verification.
 *
 * The identity-service injects its existing `TokenService` (which wraps
 * `@nestjs/jwt` with HS256 + issuer/audience + revocation semantics). The four
 * non-identity services inject `SharedJwtVerifier` (this package), which verifies
 * the SAME HS256 token with the SAME secret — so a token issued by identity is
 * trusted everywhere, without a second authentication mechanism (ARR SEC-2,
 * Sprint 1 requirement: "implement authentication according to the existing
 * identity/JWT architecture. Do NOT create a second authentication mechanism").
 *
 * Claims mirror identity's `AccessTokenClaims` (kept structurally compatible;
 * the identity service owns the canonical type, this is the read-side shape).
 */
export interface AccessTokenClaims {
  readonly sub: string;
  readonly tenant_id: string;
  readonly tenant_tier: string;
  readonly roles: readonly string[];
  readonly scope: string;
  readonly aal: number;
  readonly session_id: string;
  readonly auth_time: number;
  /** Expiry (Unix seconds) — present on every verified token. */
  readonly exp: number;
}

export interface VerifiedToken extends AccessTokenClaims {
  readonly jti: string;
}

/**
 * Port implemented by identity's `TokenService` and by this package's
 * `SharedJwtVerifier`. Throws on any verification failure (the guard maps to 401).
 */
export interface TokenVerifier {
  verifyAccess(token: string): Promise<VerifiedToken>;
}

/**
 * Optional revocation check. Identity injects its Redis-backed `RevocationStore`;
 * the four read-mostly services pass `undefined` (they hold no auth state and
 * rely on short access-token TTLs — acceptable per the Sprint 1 design).
 */
export interface RevocationChecker {
  isRevoked(jti: string, sub: string): Promise<boolean>;
}

/**
 * Optional permission resolution. Identity injects its `RoleRepository` (live
 * `iam.role_permissions` JOIN); the four services that need RBAC inject a small
 * DB-backed resolver against the same schema. Authentication-only services pass
 * `undefined` (no permissions resolved — `@RequirePermissions` would deny all).
 */
export interface PermissionResolver {
  permissionsForUser(tenantId: string, userId: string): Promise<readonly string[]>;
}
