import { NotImplementedError } from '@/lib/errors';
import type {
  ForgotPasswordPayload,
  LoginResponse,
  LoginResponseWire,
  MeResponseWire,
  MfaFactor,
  MfaVerifyPayload,
  RefreshResponse,
  RefreshResponseWire,
  RegisterPayload,
  RegisterResponse,
  ResetPasswordPayload,
  User,
} from '@/types/auth.types';
import { apiGet, apiPost, apiPostNoContent } from './client';

/**
 * Auth API layer.
 *
 * The identity-service returns snake_case JSON on the wire. These functions
 * fetch the raw `*Wire` payloads via the shared client helpers and map them to
 * the camelCase types the rest of the app consumes. The mapping is the single
 * place where the wire contract is translated.
 */

/** Map a raw login payload (snake_case) to the camelCase login response. */
function mapLoginResponse(wire: LoginResponseWire): LoginResponse {
  return {
    accessToken: wire.access_token,
    refreshToken: wire.refresh_token,
    tokenType: wire.token_type,
    expiresIn: wire.expires_in,
    user: {
      id: wire.user.id,
      email: wire.user.email,
      tenantId: wire.user.tenant_id,
      tenantName: wire.user.tenant_name ?? null,
      roles: wire.user.roles,
    },
  };
}

/** Map a raw refresh payload (snake_case) to the camelCase refresh response. */
function mapRefreshResponse(wire: RefreshResponseWire): RefreshResponse {
  return {
    accessToken: wire.access_token,
    refreshToken: wire.refresh_token,
    expiresIn: wire.expires_in,
  };
}

/** Map a raw /me payload (snake_case) to the camelCase user. */
function mapMeResponse(wire: MeResponseWire): User {
  return {
    id: wire.id,
    email: wire.email,
    tenantId: wire.tenant_id,
    tenantName: wire.tenant_name ?? null,
    roles: wire.roles,
    permissions: wire.permissions,
  };
}

/**
 * POST /api/v1/auth/login
 *
 * Authenticate with email + password. Requires X-Tenant-Id header.
 */
export async function login(
  email: string,
  password: string,
  tenantId: string,
): Promise<LoginResponse> {
  const wire = await apiPost<unknown, LoginResponseWire>(
    '/auth/login',
    { email, password },
    { headers: { 'X-Tenant-Id': tenantId } },
  );
  return mapLoginResponse(wire);
}

/**
 * POST /api/v1/auth/refresh
 *
 * Exchange a valid refresh token for a new access + refresh token pair.
 */
export async function refreshToken(refreshToken: string): Promise<RefreshResponse> {
  const wire = await apiPost<unknown, RefreshResponseWire>('/auth/refresh', {
    refresh_token: refreshToken,
  });
  return mapRefreshResponse(wire);
}

/**
 * GET /api/v1/auth/me
 *
 * Fetch the current authenticated user's profile, roles, and permissions.
 */
export async function getMe(): Promise<User> {
  const wire = await apiGet<MeResponseWire>('/auth/me');
  return mapMeResponse(wire);
}

/**
 * POST /api/v1/auth/logout
 *
 * Revoke the current session's tokens.
 */
export async function logout(): Promise<void> {
  return apiPostNoContent('/auth/logout');
}

/**
 * POST /api/v1/auth/logout-all
 *
 * Revoke all sessions for the current user.
 */
export async function logoutAll(): Promise<void> {
  return apiPostNoContent('/auth/logout-all');
}

// ────────────────────────────────────────────────────────────────────────────
// The endpoints below are documented (`Authentication.md` §5.1) but NOT yet
// implemented in identity-service. Each is a typed stub that throws
// `NotImplementedError`. When the backend lands an endpoint, replace the stub
// body with the real `apiPost`/`apiGet` call + wire→camelCase mapping (the
// pattern is identical to `login()` above).
// ────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/auth/register — self-service registration (if tenant allows).
 *
 * STUB: identity-service has no public registration route yet (only the
 * admin-scoped `POST /iam/users`). Rate-limited 5/min per IP per the docs.
 */
export async function register(_payload: RegisterPayload): Promise<RegisterResponse> {
  void _payload;
  throw new NotImplementedError('POST /auth/register');
}

/**
 * POST /api/v1/auth/forgot-password — send a password-reset email.
 *
 * STUB: no endpoint, no recovery-token issuance, no email-send path exists.
 * Rate-limited 3/hour per email. The UI must respond identically whether or
 * not the email exists (no user-enumeration oracle, ARR SEC-3).
 */
export async function forgotPassword(_payload: ForgotPasswordPayload): Promise<void> {
  void _payload;
  throw new NotImplementedError('POST /auth/forgot-password');
}

/**
 * POST /api/v1/auth/reset-password — reset password with a one-time token.
 *
 * STUB: no endpoint exists. Token TTL is 30 minutes, single use (AUTH-BR-09).
 */
export async function resetPassword(_payload: ResetPasswordPayload): Promise<void> {
  void _payload;
  throw new NotImplementedError('POST /auth/reset-password');
}

/**
 * POST /api/v1/auth/login/mfa — verify an MFA challenge code.
 *
 * STUB: no MFA backend exists (only an always-false `mfa_enabled` flag). The
 * documented 202 flow returns `{ mfa_required, available_methods, mfa_token,
 * expires_in }` on login when a second factor is required; this endpoint
 * exchanges `mfa_token` + code for access/refresh tokens.
 */
export async function verifyMfa(_payload: MfaVerifyPayload): Promise<LoginResponse> {
  void _payload;
  throw new NotImplementedError('POST /auth/login/mfa');
}

/**
 * GET /api/v1/auth/mfa — list the current user's registered MFA factors.
 *
 * STUB: no MFA backend exists. Requires Bearer JWT + step-up (aal=2).
 */
export async function getMfaFactors(): Promise<MfaFactor[]> {
  throw new NotImplementedError('GET /auth/mfa');
}
