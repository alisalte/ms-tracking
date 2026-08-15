/**
 * PermissionsGuard — authorization. Apply `@RequirePermissions('maps.read')` to
 * a controller/route; the guard checks the authenticated context's permissions
 * (union across roles, wildcard `*` for tenant-admin). Routes without the
 * decorator only require authentication. `@Public()` routes are skipped.
 *
 * OPA is the authoritative evaluator in production; this is the in-process
 * fallback (docs/specs/02 §6).
 */
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
// biome-ignore lint/style/useImportType: NestJS DI needs the Reflector class value at runtime.
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { getAuthContext } from './authenticated-context.js';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from './decorators.js';
import { PermissionDeniedError } from './errors.js';
import { permissionSatisfies } from './permission-catalog.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    if (this.isPublic(context)) return true;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const granted = getAuthContext(req).permissions;
    for (const perm of required) {
      if (!permissionSatisfies(granted, perm)) {
        throw new PermissionDeniedError(perm);
      }
    }
    return true;
  }

  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }
}
