/**
 * Request-context helpers — extract the audit actor fields (principal id, IP,
 * user-agent, request/correlation id) from an Express request. Controllers pass
 * the result into use-cases that record audit entries.
 */
import type { Request } from 'express';
import type { AuditActor } from '../../application/audit/audit-manager.js';
import { getPrincipal } from './principal.js';

export function actorFromRequest(req: Request): AuditActor & { actorId: string } {
  const p = getPrincipal(req);
  return {
    actorId: p.userId,
    actorType: 'USER',
    ipAddress: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
    requestId: (req.headers['x-request-id'] as string | undefined) ?? null,
  };
}
