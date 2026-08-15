/**
 * AuthenticatedContext — the trusted identity attached to a request by the auth
 * guards. Built from verified JWT claims (or an API-key resolution). Controllers
 * and repositories read the tenant id and permissions from here, NEVER from the
 * request body or a client-supplied header (INV-I02).
 *
 * `Principal` is kept as a back-compat alias (identity-service's original name).
 */
import type { Request } from 'express';

export interface AuthenticatedContext {
  readonly userId: string;
  readonly tenantId: string;
  readonly tenantTier: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly sessionId: string;
  readonly jti: string;
  /** Auth method that established this context. */
  readonly authMethod: 'JWT' | 'API_KEY';
}

/** Back-compat alias for identity-service's original `Principal` name. */
export type Principal = AuthenticatedContext;

declare module 'express' {
  interface Request {
    /** The authenticated caller — set by JwtAuthGuard / ApiKeyAuthGuard. */
    auth?: AuthenticatedContext;
  }
}

/** Read the authenticated context, throwing if a guard failed to attach one. */
export function getAuthContext(req: Request): AuthenticatedContext {
  const ctx = req.auth;
  if (!ctx) {
    throw new Error('No authenticated context on request — a guard failed to attach one.');
  }
  return ctx;
}

/** Back-compat alias for identity-service's original `getPrincipal`. */
export const getPrincipal = getAuthContext;
