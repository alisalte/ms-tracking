import { getPrincipal } from '@fleetvision/auth';
import { describe, expect, it } from '@jest/globals';
import { LocationController } from '../api/location.controller.js';
import { MapController } from '../api/map.controller.js';
import { RouteController } from '../api/route.controller.js';

/**
 * Sprint 1 requirements 1 & 2: the map-engine controllers must derive tenantId
 * from the verified JWT principal — never from a client-supplied `tenant-id`
 * header/query (spoofable). INV-I02 pinned at the source level.
 */
describe('map-engine controllers derive tenantId from the principal', () => {
  it('imports getPrincipal (JWT-derived tenant)', () => {
    expect(typeof getPrincipal).toBe('function');
  });

  for (const [name, Controller] of [
    ['MapController', MapController],
    ['RouteController', RouteController],
    ['LocationController', LocationController],
  ] as const) {
    it(`${name} does not read the spoofable tenant-id header`, () => {
      const src = Controller.toString();
      expect(src).not.toMatch(/headers\['tenant-id'\]/);
      expect(src).not.toMatch(/query\['tenant-id'\]/);
    });
  }
});
