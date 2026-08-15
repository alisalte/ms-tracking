import 'reflect-metadata';
import {
  CompositeAuthGuard,
  PERMISSIONS_KEY,
  PermissionsGuard,
  RequirePermissions,
} from '@fleetvision/auth';
import { describe, expect, it } from '@jest/globals';
import { AdminController } from '../api/admin/admin.controller.js';

/**
 * Sprint 1 requirements 1 & 3 (ported to the merged line's architecture): the
 * device-gateway /admin/* endpoints must be admin-only. This line enforces
 * authentication + authorization with the GLOBAL CompositeAuthGuard +
 * PermissionsGuard (registered app-wide — Sprint B), so the controller-level
 * contract to pin is the @RequirePermissions metadata.
 */
describe('device-gateway admin controller is admin-only', () => {
  it('imports CompositeAuthGuard + PermissionsGuard + RequirePermissions', () => {
    expect(typeof CompositeAuthGuard).toBe('function');
    expect(typeof PermissionsGuard).toBe('function');
    expect(typeof RequirePermissions).toBe('function');
  });

  it('AdminController requires telemetry.gateway.manage (global guards enforce it)', () => {
    const perms = Reflect.getMetadata(PERMISSIONS_KEY, AdminController) as string[] | undefined;
    expect(perms).toBeDefined();
    expect(perms).toContain('telemetry.gateway.manage');
  });
});
