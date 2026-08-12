/**
 * Principal — the authenticated caller attached to the request by the auth
 * guards. Built from verified JWT claims (or an API-key resolution). Controllers
 * and guards read the tenant id and permissions from here, never from the body.
 *
 * INV-I02: tenant_id is ALWAYS derived from the verified principal, never from
 * the request body/query/header.
 */
import type { Request } from 'express';

export interface Principal {
  readonly userId: string;
  readonly tenantId: string;
  readonly tenantTier: string;
  readonly roles: readonly string[];
  readonly sessionId: string;
  readonly jti: string;
  /** Access-token expiry (Unix seconds) — used to size the logout blocklist TTL. */
  readonly exp: number;
  /** Resolved permission strings (union of role permissions). Empty for
   * services that authenticate only (gps/map/media) — RBAC stays in identity. */
  readonly permissions: readonly string[];
  /** Auth method that established this principal. */
  readonly authMethod: 'JWT' | 'API_KEY';
}

declare module 'express' {
  interface Request {
    principal?: Principal;
  }
}

/** Read the principal a guard attached; throw if a route handler ran without one. */
export function getPrincipal(req: Request): Principal {
  const p = req.principal;
  if (!p) {
    throw new Error('No principal on request — a guard failed to attach one.');
  }
  return p;
}
