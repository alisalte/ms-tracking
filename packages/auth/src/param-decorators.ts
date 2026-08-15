/**
 * Param decorators that inject the verified identity into a handler. They read
 * `req.auth` (populated by the auth guards) — never a client-supplied value.
 */
import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { getAuthContext } from './authenticated-context.js';

/** Inject the full AuthenticatedContext (throws if unauthenticated). */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return getAuthContext(req);
});

/** Inject the verified tenant id (throws if unauthenticated). */
export const CurrentTenant = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return getAuthContext(req).tenantId;
});
