/**
 * Request-scoped correlation context.
 *
 * Every log line MUST carry the mandatory correlation fields (01 §11.3):
 *   timestamp, level, service, trace_id, correlation_id, tenant_id, user_id, message, context
 *
 * These are populated per-request from the incoming `X-Request-Id` /
 * W3C `traceparent` headers (or generated if absent), and from the JWT for
 * tenant_id / user_id. The async hook makes them available deep in the call
 * stack without threading them through every function signature.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface CorrelationContext {
  /** W3C trace id; joins logs ↔ traces ↔ events. Generated if not provided. */
  readonly traceId?: string;
  /** W3C span id (the parent of this request's spans). */
  readonly spanId?: string;
  /** App-level correlation/request id — the X-Request-Id header value. */
  readonly correlationId?: string;
  /** Owning tenant (from JWT). */
  readonly tenantId?: string;
  /** Authenticated subject (from JWT `sub`). */
  readonly userId?: string;
}

const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

/** Run a callback with a correlation context active (set by request middleware). */
export function withCorrelation<T>(ctx: CorrelationContext, fn: () => T): T {
  return correlationStorage.run(ctx, fn);
}

/** Read the active correlation context (undefined outside a request scope). */
export function getCorrelation(): CorrelationContext {
  return correlationStorage.getStore() ?? {};
}

/** Merge into the active context (e.g. after JWT decode adds tenant_id). */
export function augmentCorrelation(patch: Partial<CorrelationContext>): CorrelationContext {
  const current = correlationStorage.getStore() ?? {};
  const next = { ...current, ...patch };
  correlationStorage.enterWith(next);
  return next;
}
