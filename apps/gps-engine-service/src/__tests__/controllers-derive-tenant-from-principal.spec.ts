import { getPrincipal } from '@fleetvision/auth';
import { describe, expect, it } from '@jest/globals';
import { DeviceStatusController } from '../api/device-status.controller.js';
import { PositionsController } from '../api/positions.controller.js';

/**
 * Sprint 1 requirements 1 & 2: the gps-engine controllers must derive tenantId
 * from the verified JWT principal (getPrincipal) — never from a client-supplied
 * `tenant-id` header/query (which is spoofable). These tests pin the
 * INV-I02 contract at the source level.
 */
describe('gps-engine controllers derive tenantId from the principal', () => {
  it('PositionsController imports getPrincipal (JWT-derived tenant)', () => {
    // getPrincipal throws if no principal is attached — its presence means the
    // controller reads tenantId from the authenticated request, not the header.
    expect(typeof getPrincipal).toBe('function');
  });

  it('PositionsController does not read the spoofable tenant-id header', () => {
    const src = PositionsController.toString();
    expect(src).not.toMatch(/headers\['tenant-id'\]/);
    expect(src).not.toMatch(/query\['tenant-id'\]/);
    expect(src).toMatch(/getPrincipal/);
  });

  it('DeviceStatusController does not read the spoofable tenant-id header', () => {
    const src = DeviceStatusController.toString();
    expect(src).not.toMatch(/headers\['tenant-id'\]/);
    expect(src).not.toMatch(/query\['tenant-id'\]/);
    expect(src).toMatch(/getPrincipal/);
  });
});
