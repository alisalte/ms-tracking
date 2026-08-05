/**
 * Device Gateway domain errors.
 *
 * The gateway participates in the Telematics bounded context (02 §1, Context 6)
 * and owns only ingestion-tier, transient state (06 §11). Its errors fall into
 * three categories — session-state-machine violations, protocol framing/decode
 * failures, and authentication/resolve failures — each with a stable code so
 * the pipeline (§8) can route them to the right metric/failure path.
 */
import { DomainError } from '@fleetvision/shared-kernel';

/** Session lifecycle transition that the state machine (06 §6.1) forbids. */
export class IllegalSessionTransitionError extends DomainError {
  public readonly code = 'DEVICE_SESSION_ILLEGAL_TRANSITION';
  constructor(message: string) {
    super(message);
    this.name = 'IllegalSessionTransitionError';
  }
}

/** A session invariant was violated (e.g. publish attempted pre-auth — 06 §6.1). */
export class SessionInvariantError extends DomainError {
  public readonly code = 'DEVICE_SESSION_INVARIANT';
  constructor(message: string) {
    super(message);
    this.name = 'SessionInvariantError';
  }
}

/** Framing, checksum, or size-limit failure on a raw packet (06 §8 validate). */
export class ProtocolError extends DomainError {
  public readonly code = 'DEVICE_PROTOCOL_ERROR';
  constructor(
    message: string,
    /** Adapter that raised the error, for per-protocol metrics. */
    public readonly protocolId: string,
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}

/** Device could not be resolved or is not allowed to connect (06 §7.3). */
export class AuthError extends DomainError {
  public readonly code: string;
  constructor(
    message: string,
    /**
     * One of the auth-failure outcomes from 06 §7.3 — drives the metric name
     * (`auth.fail.unknown` / `.disabled` / `.tenant_suspended` / `.unreachable`).
     */
    public readonly outcome: 'unknown' | 'disabled' | 'tenant_suspended' | 'unreachable',
  ) {
    super(message);
    this.name = 'AuthError';
    this.code = `DEVICE_AUTH_${outcome.toUpperCase()}`;
  }
}
