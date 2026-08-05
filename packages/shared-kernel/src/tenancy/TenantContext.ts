/**
 * TenantContext — the request-scoped tenant plus principal identity.
 * Built once per request by the tenancy middleware (from the JWT) and made
 * available to handlers/repositories so they never read tenant_id from a body.
 *
 * The full middleware + AsyncLocalStorage wiring lives in `@fleetvision/tenancy`
 * (Codebase Architecture §10); this package owns only the type.
 */
export interface TenantContext {
  /** Branded tenant id, guaranteed derived from the JWT (INV-I02). */
  readonly tenantId: string;
  /** Authenticated subject (user or service account) from the JWT `sub`. */
  readonly subjectId?: string;
  /** W3C trace id for correlation across logs/traces/events. */
  readonly traceId?: string;
  /** The idempempotency key, if the client supplied one on a write. */
  readonly idempotencyKey?: string;
}
