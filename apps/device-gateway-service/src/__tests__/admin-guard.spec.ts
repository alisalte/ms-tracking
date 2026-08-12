import 'reflect-metadata';
import { JwtAuthGuard, PermissionsGuard, RequirePermissions } from '@fleetvision/auth';
import { describe, expect, it } from '@jest/globals';
import { AdminController } from '../api/admin/admin.controller.js';

/**
 * Sprint 1 requirements 1 & 3: the device-gateway /admin/* endpoints must be
 * admin-only — guarded by JwtAuthGuard (authentication) AND PermissionsGuard
 * (authorization) with the `telemetry.gateway.manage` permission. Importing the
 * controller module evaluates the decorators, which store metadata via
 * Reflect.defineMetadata; we read it back to pin the wiring.
 */
describe('device-gateway admin controller is admin-only', () => {
  it('imports JwtAuthGuard + PermissionsGuard + RequirePermissions', () => {
    expect(typeof JwtAuthGuard).toBe('function');
    expect(typeof PermissionsGuard).toBe('function');
    expect(typeof RequirePermissions).toBe('function');
  });

  it('AdminController applies JwtAuthGuard + PermissionsGuard', () => {
    const guards = Reflect.getMetadata('__guards__', AdminController) as unknown[] | undefined;
    expect(guards).toBeDefined();
    const guardNames = (guards ?? []).map((g) => (typeof g === 'function' ? g.name : String(g)));
    expect(guardNames).toContain('JwtAuthGuard');
    expect(guardNames).toContain('PermissionsGuard');
  });

  it('AdminController requires telemetry.gateway.manage', () => {
    const perms = Reflect.getMetadata('requiredPermissions', AdminController) as
      | string[]
      | undefined;
    expect(perms).toBeDefined();
    expect(perms).toContain('telemetry.gateway.manage');
  });
});
