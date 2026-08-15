/**
 * Build the trusted service-level ActorContext from the verified credential
 * (Sprint B AuthenticatedContext) + the HTTP request. The tenant ALWAYS comes
 * from the credential — never a client header (INV-I02).
 */
import type { AuthenticatedContext } from '@fleetvision/auth';
import type { Request } from 'express';
import type { ActorContext } from '../../application/service-context.js';

export function actorFrom(auth: AuthenticatedContext, req: Request): ActorContext {
  return {
    tenantId: auth.tenantId,
    actorId: auth.userId,
    actorType: auth.authMethod === 'API_KEY' ? 'SERVICE' : 'USER',
    requestId: req.header('x-request-id') ?? null,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

/** Minimal context for reads (no audit, so request metadata is unused). */
export function readActor(auth: AuthenticatedContext): ActorContext {
  return {
    tenantId: auth.tenantId,
    actorId: auth.userId,
    actorType: auth.authMethod === 'API_KEY' ? 'SERVICE' : 'USER',
    requestId: null,
    ipAddress: null,
    userAgent: null,
  };
}
