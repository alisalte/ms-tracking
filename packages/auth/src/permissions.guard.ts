/**
 * Permissions guard + decorator. Apply `@RequirePermissions('iam.user.create')`
 * to a controller/route; the guard checks the principal's resolved permission
 * set. The wildcard `*` (tenant-admin) satisfies all.
 *
 * Identity-service injects permissions via its live `RoleRepository`; the four
 * non-identity services that need RBAC inject a DB-backed resolver against the
 * same `iam.role_permissions` schema. Authentication-only routes simply omit
 * `@RequirePermissions`.
 *
 * OPA is the authoritative evaluator in production (cached 5s); this is the
 * in-process fallback used until OPA lands (docs/specs/02 §6).
 */
import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
// biome-ignore lint/style/useImportType: NestJS DI needs the Reflector class value at runtime.
import { Reflector } from '@nestjs/core';
import { PermissionDeniedError } from './errors.js';
import { getPrincipal } from './principal.js';

export const PERMISSIONS_KEY = 'requiredPermissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Does a granted permission set satisfy the required permission?
 * Wildcard (`*`) grants everything; otherwise an exact match is required.
 * (Kept here so identity's domain/permissions.ts can re-export without a cycle.)
 */
export function permissionSatisfies(granted: readonly string[], required: string): boolean {
  if (granted.includes('*')) return true;
  return granted.includes(required);
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const principal = getPrincipal(context.switchToHttp().getRequest());
    const granted = principal.permissions;
    for (const perm of required) {
      if (!permissionSatisfies(granted, perm)) {
        throw new PermissionDeniedError(perm);
      }
    }
    return true;
  }
}
