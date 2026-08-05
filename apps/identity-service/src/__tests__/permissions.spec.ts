import { describe, expect, it } from '@jest/globals';
import {
  ALL_IAM_PERMISSIONS,
  IamPermissions,
  SYSTEM_ROLES,
  WILDCARD_PERMISSION,
  permissionSatisfies,
} from '../domain/permissions.js';

describe('permission catalog & RBAC', () => {
  it('satisfies an exact permission', () => {
    expect(permissionSatisfies([IamPermissions.USER_READ], IamPermissions.USER_READ)).toBe(true);
  });

  it('denies a missing permission', () => {
    expect(permissionSatisfies([IamPermissions.USER_READ], IamPermissions.USER_CREATE)).toBe(false);
  });

  it('wildcard grants everything', () => {
    expect(permissionSatisfies([WILDCARD_PERMISSION], IamPermissions.USER_CREATE)).toBe(true);
    expect(permissionSatisfies([WILDCARD_PERMISSION], 'any.unknown.permission')).toBe(true);
  });

  it('the tenant-admin role carries the wildcard', () => {
    const admin = SYSTEM_ROLES.find((r) => r.name === 'tenant-admin');
    expect(admin).toBeDefined();
    expect(admin?.permissions).toContain(WILDCARD_PERMISSION);
    expect(admin?.mfaRequired).toBe(true);
  });

  it('every system role grants at least one permission', () => {
    for (const role of SYSTEM_ROLES) {
      expect(role.permissions.length).toBeGreaterThan(0);
    }
  });

  it('all IAM permissions are non-empty strings in the catalog', () => {
    for (const p of ALL_IAM_PERMISSIONS) {
      expect(typeof p).toBe('string');
      expect(p.length).toBeGreaterThan(0);
    }
  });
});
