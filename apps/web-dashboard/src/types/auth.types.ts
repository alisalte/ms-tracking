/**
 * Auth-related type definitions.
 *
 * The identity-service (`apps/identity-service/.../auth.controller.ts`) returns
 * JSON with **snake_case** keys on the wire (JSON:API convention). The raw
 * `*Wire` types below mirror that contract 1:1. The API layer
 * (`api/auth.api.ts`) maps each wire payload to the camelCase types (UI-facing)
 * so the rest of the app never touches snake_case.
 */

/** User identity returned by POST /login and GET /me (camelCase, UI-facing). */
export interface User {
  id: string;
  email: string;
  tenantId: string;
  roles: readonly string[];
  permissions: readonly string[];
}

/** Payload sent to POST /api/v1/auth/login. */
export interface LoginPayload {
  email: string;
  password: string;
}

/** Payload sent to POST /api/v1/auth/refresh. */
export interface RefreshPayload {
  refreshToken: string;
}

/** Successful login response (camelCase, mapped from `LoginResponseWire`). */
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  user: Pick<User, 'id' | 'email' | 'tenantId' | 'roles'>;
}

/** Successful refresh response (camelCase, mapped from `RefreshResponseWire`). */
export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// ── Raw wire types (snake_case, exact backend contract) ──────────────────────

/** Raw POST /auth/login response payload (snake_case on the wire). */
export interface LoginResponseWire {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: { id: string; email: string; tenant_id: string; roles: readonly string[] };
}

/** Raw POST /auth/refresh response payload (snake_case on the wire). */
export interface RefreshResponseWire {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** Raw GET /auth/me response payload (snake_case on the wire). */
export interface MeResponseWire {
  id: string;
  email: string;
  tenant_id: string;
  roles: readonly string[];
  permissions: readonly string[];
}

/** Persisted token pair in localStorage. */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tenantId: string;
}

/** Tenant ID context required for all auth requests. */
export type TenantId = string;

// ── User profile (extended) ──────────────────────────────────────────────────

/** User account status (mirrors the backend `UserStatus` enum). */
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED' | 'LOCKED';

/**
 * Extended user profile surfaced by the IAM user view and (future) `/me`.
 * Extends the auth `User` with profile/security fields the Security Center
 * needs (`IAM.md` §3.1, `Authentication.md` §9.4).
 */
export interface UserProfile extends User {
  username: string;
  displayName: string | null;
  status: UserStatus;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
}

// ── Registration ─────────────────────────────────────────────────────────────

/** Payload sent to POST /api/v1/auth/register (documented; backend pending). */
export interface RegisterPayload {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}

/** Successful registration response (camelCase, mapped from wire). */
export interface RegisterResponse {
  id: string;
  email: string;
  username: string;
  status: UserStatus;
}

/** Raw POST /auth/register response (snake_case; backend pending). */
export interface RegisterResponseWire {
  id: string;
  email: string;
  username: string;
  status: string;
}

// ── Forgot / reset password (documented; backend pending) ────────────────────

/** Payload sent to POST /api/v1/auth/forgot-password. */
export interface ForgotPasswordPayload {
  email: string;
}

/** Payload sent to POST /api/v1/auth/reset-password (AUTH-BR-09: 30-min TTL, one-time). */
export interface ResetPasswordPayload {
  token: string;
  password: string;
}

// ── MFA (documented; backend pending) ────────────────────────────────────────

/** MFA factor types per Security.md §3.4. */
export type MfaMethod = 'totp' | 'webauthn' | 'backup-code';

/**
 * MFA challenge issued on login when the account requires a second factor
 * (HTTP 202). Documented contract (`Authentication.md` §8.1):
 * `{ mfa_required, available_methods, mfa_token, expires_in }`.
 */
export interface MfaChallenge {
  mfaRequired: boolean;
  mfaToken: string;
  availableMethods: readonly MfaMethod[];
  expiresIn: number;
}

/** Raw 202 MFA challenge (snake_case on the wire). */
export interface MfaChallengeWire {
  mfa_required: boolean;
  mfa_token: string;
  available_methods: readonly string[];
  expires_in: number;
}

/** Payload sent to POST /api/v1/auth/login/mfa. */
export interface MfaVerifyPayload {
  mfaToken: string;
  code: string;
  method: MfaMethod;
}

/** A registered MFA factor (GET /auth/mfa). */
export interface MfaFactor {
  id: string;
  method: MfaMethod;
  label: string;
  enrolledAt: string;
  lastUsedAt: string | null;
}
