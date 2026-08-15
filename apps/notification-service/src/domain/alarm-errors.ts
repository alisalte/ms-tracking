/**
 * Alarm domain errors — concrete DomainError subclasses so the
 * GlobalExceptionFilter maps them to the right HTTP status.
 */
import { DomainError } from '@fleetvision/shared-kernel';

/** Illegal alarm lifecycle transition (e.g. RESOLVED → OPEN). */
export class IllegalStatusTransitionError extends DomainError {
  public readonly code = 'BUSINESS_RULE_VIOLATION';
}

/** Alarm occurrence not found. */
export class AlarmNotFoundError extends DomainError {
  public readonly code = 'NOT_FOUND';
  constructor() {
    super('Alarm not found.');
  }
}

/** Alarm rule not found. */
export class AlarmRuleNotFoundError extends DomainError {
  public readonly code = 'NOT_FOUND';
  constructor() {
    super('Alarm rule not found.');
  }
}
