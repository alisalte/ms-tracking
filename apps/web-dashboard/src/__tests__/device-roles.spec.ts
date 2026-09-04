import { describe, expect, it } from 'vitest';

import { defaultDeviceRoles, displayDeviceRoles, primaryDeviceRole } from '@/lib/device-roles';

describe('device-roles', () => {
  it('defaults meitrack units to tracker + camera', () => {
    expect(defaultDeviceRoles('meitrack')).toEqual(['TRACKER', 'MDVR']);
    expect(defaultDeviceRoles('gt06')).toEqual(['TRACKER']);
  });

  it('uses TRACKER as the primary role when it is in the set', () => {
    expect(primaryDeviceRole(['MDVR', 'TRACKER', 'SENSOR'])).toBe('TRACKER');
    expect(primaryDeviceRole(['MDVR', 'SENSOR'])).toBe('MDVR');
  });

  it('falls back to the legacy single role when roles is empty', () => {
    expect(displayDeviceRoles('MDVR', [])).toEqual(['MDVR']);
    expect(displayDeviceRoles('TRACKER', ['TRACKER', 'SENSOR'])).toEqual(['TRACKER', 'SENSOR']);
  });
});
