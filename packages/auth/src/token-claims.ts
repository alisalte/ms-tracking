/**
 * Access-token claims contract. Flat (Authentication.md §6.1). identity-service
 * signs these; every service verifies them. Sprint B adds `permissions` so the
 * guard can authorize without a per-request DB read (stateless downstream auth).
 */
export interface AccessTokenClaims {
  readonly sub: string;
  readonly tenant_id: string;
  readonly tenant_tier: string;
  readonly roles: readonly string[];
  /** Sprint B: resolved permission union embedded at login/refresh. */
  readonly permissions: readonly string[];
  readonly scope: string;
  readonly aal: number;
  readonly session_id: string;
  readonly auth_time: number;
}

/** Verified claims also carry the standard registered JWT fields. */
export type VerifiedAccessToken = AccessTokenClaims & {
  readonly jti: string;
  readonly iat?: number;
  readonly exp?: number;
};
