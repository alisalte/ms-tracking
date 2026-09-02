/**
 * Permission catalog + decision logic tests (Sprint B). The catalog now lives in
 * @fleetvision/auth; these pin the wildcard/exact-match behavior and that the
 * downstream-service permissions are present.
 */
import { describe, expect, it } from '@jest/globals';
import { Permissions, WILDCARD_PERMISSION, permissionSatisfies } from '../permission-catalog.js';

describe('permissionSatisfies', () => {
  it('wildcard grants everything', () => {
    expect(permissionSatisfies([WILDCARD_PERMISSION], 'tracking.read')).toBe(true);
    expect(permissionSatisfies([WILDCARD_PERMISSION], 'telemetry.gateway.manage')).toBe(true);
  });

  it('exact match grants', () => {
    expect(permissionSatisfies(['tracking.read'], 'tracking.read')).toBe(true);
  });

  it('no match denies', () => {
    expect(permissionSatisfies(['maps.read'], 'tracking.read')).toBe(false);
    expect(permissionSatisfies([], 'tracking.read')).toBe(false);
  });
});

describe('permission catalog (Sprint B additions)', () => {
  it('includes the downstream-service permissions', () => {
    expect(Permissions.TRACKING_READ).toBe('tracking.read');
    expect(Permissions.MAPS_READ).toBe('maps.read');
    expect(Permissions.MAPS_WRITE).toBe('maps.write');
    expect(Permissions.MEDIA_READ).toBe('media.read');
    expect(Permissions.MEDIA_WRITE).toBe('media.write');
    expect(Permissions.FLEET_DRIVER_READ).toBe('fleet.driver.read');
    expect(Permissions.FLEET_DRIVER_CREATE).toBe('fleet.driver.create');
  });
});
