/**
 * IAM-specific domain errors. Each carries a canonical code matching
 * API_Design.md §8.3 so the GlobalExceptionFilter maps it to the right HTTP
 * status (UNAUTHORIZED→401, CONFLICT→409, etc.). Auth errors are deliberately
 * generic ("invalid credentials") to avoid user-enumeration oracles (ARR SEC-3).
 */
import { DomainError } from '@fleetvision/shared-kernel';

/** Generic invalid-credentials error — never disclose whether the user exists. */
export class InvalidCredentialsError extends DomainError {
  public readonly code = 'UNAUTHORIZED';
  constructor() {
    super('Invalid credentials.');
  }
}

/** Account is locked after too many failed attempts (AUTH-BR-03). */
export class AccountLockedError extends DomainError {
  public readonly code = 'UNAUTHORIZED';
  constructor(details?: Record<string, unknown>) {
    super('Account is temporarily locked.', details);
  }
}

/** Tenant is suspended/deprovisioned — all logins denied (TEN-BR-06). */
export class TenantNotActiveError extends DomainError {
  public readonly code = 'FORBIDDEN';
  constructor() {
    super('Tenant is not active.');
  }
}

/** Refresh token reuse detected — entire family revoked (AUTH-BR-08). */
export class RefreshTokenReuseError extends DomainError {
  public readonly code = 'UNAUTHORIZED';
  constructor() {
    super('Refresh token has been revoked.');
  }
}

/** Token failed verification (signature, expiry, revocation). */
export class TokenInvalidError extends DomainError {
  public readonly code = 'UNAUTHORIZED';
  constructor() {
    super('Token is invalid or expired.');
  }
}

/** Email already in use within the tenant (INV-IAM-01). */
export class EmailAlreadyUsedError extends DomainError {
  public readonly code = 'CONFLICT';
  constructor() {
    super('Email is already in use within this tenant.');
  }
}

/** Username taken platform-wide (INV-IAM-02). */
export class UsernameTakenError extends DomainError {
  public readonly code = 'CONFLICT';
  constructor() {
    super('Username is already taken.');
  }
}

/** Password fails the policy (length/complexity/history). */
export class PasswordPolicyError extends DomainError {
  public readonly code = 'VALIDATION_ERROR';
}

/** Illegal status transition (INV-IAM-05). */
export class IllegalStatusTransitionError extends DomainError {
  public readonly code = 'CONFLICT';
}

/** Permission denied by RBAC. */
export class PermissionDeniedError extends DomainError {
  public readonly code = 'FORBIDDEN';
  constructor(permission: string) {
    super(`Missing required permission: ${permission}`);
  }
}

/** Resource not found (mapped to 404 — also used for existence-protection). */
export class NotFoundError extends DomainError {
  public readonly code = 'NOT_FOUND';
  constructor(resource: string) {
    super(`${resource} not found.`);
  }
}
