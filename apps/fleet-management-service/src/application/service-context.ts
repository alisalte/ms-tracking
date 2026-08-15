/**
 * Service-level request context — the trusted identity + audit metadata derived
 * from the verified credential (Sprint B). Passed into every application service
 * method so the service never trusts a client-supplied tenant_id (INV-I02).
 */
export interface ActorContext {
  /** Trusted tenant id from the verified JWT/API-key credential. */
  readonly tenantId: string;
  /** Authenticated actor (user id for JWT, api-key id for API_KEY); null for SYSTEM. */
  readonly actorId: string | null;
  readonly actorType: 'USER' | 'SERVICE' | 'SYSTEM';
  /** Correlation id for audit (x-request-id / traceparent). */
  readonly requestId: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}
