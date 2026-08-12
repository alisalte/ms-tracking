/**
 * Auth-package domain errors — concrete `DomainError` subclasses so the
 * GlobalExceptionFilter maps them to the correct HTTP status (FORBIDDEN→403,
 * UNAUTHORIZED→401). These are the generic-package peers of identity's
 * domain/errors.ts; identity keeps its own richer set and re-exports these where
 * useful.
 */
import { DomainError } from '@fleetvision/shared-kernel';

/** Permission denied by RBAC (maps to 403). */
export class PermissionDeniedError extends DomainError {
  public readonly code = 'FORBIDDEN';
  constructor(permission: string) {
    super(`Missing required permission: ${permission}`);
  }
}

/** Token failed verification or is absent (maps to 401). */
export class UnauthenticatedError extends DomainError {
  public readonly code = 'UNAUTHORIZED';
  constructor(message = 'Authentication required.') {
    super(message);
  }
}
