/**
 * Auth domain errors. Each carries a canonical code so the shared
 * GlobalExceptionFilter maps it to the right HTTP status (UNAUTHORIZED→401,
 * FORBIDDEN→403). Auth errors are deliberately generic to avoid user/tenant
 * enumeration oracles (ARR SEC-3).
 */
import { DomainError } from '@fleetvision/shared-kernel';

/** Token failed verification (signature, expiry, malformed, revoked). 401. */
export class TokenInvalidError extends DomainError {
  public readonly code = 'UNAUTHORIZED';
  constructor() {
    super('Token is invalid or expired.');
  }
}

/** Permission denied by RBAC. 403. */
export class PermissionDeniedError extends DomainError {
  public readonly code = 'FORBIDDEN';
  constructor(permission: string) {
    super(`Missing required permission: ${permission}`);
  }
}

/** Authenticated caller tried to access another tenant's scope. 403. */
export class TenantAccessDeniedError extends DomainError {
  public readonly code = 'FORBIDDEN';
  constructor() {
    super('Access denied for the requested tenant.');
  }
}

/** API key failed verification (unknown, wrong secret, revoked, expired). 401. */
export class ApiKeyInvalidError extends DomainError {
  public readonly code = 'UNAUTHORIZED';
  constructor() {
    super('API key is invalid, revoked, or expired.');
  }
}
