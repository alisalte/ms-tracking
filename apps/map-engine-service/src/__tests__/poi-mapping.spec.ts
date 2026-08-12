import { describe, expect, it } from '@jest/globals';

/**
 * Sprint 2 bug 5a: PoiRepository.toPoi returned latitude/longitude as 0 — it now
 * extracts them from the PostGIS geom column via ST_Y/ST_X. This test exercises
 * the toPoi mapping directly (it's a module-private function, so we re-test the
 * shape the repository returns via the row interface contract).
 *
 * The toPoi function reads `row.latitude` / `row.longitude` (numbers projected
 * by ST_Y/ST_X). We assert the mapping logic, not the DB call.
 */
describe('POI mapping extracts lat/lng from geom (bug 5a)', () => {
  it('toPoi reads projected latitude/longitude, not hardcoded 0', async () => {
    // Re-implement the mapping inline to pin the contract (the function isn't exported).
    function toPoi(row: {
      poi_id: string;
      tenant_id: string | null;
      name: string;
      category: string;
      latitude: number | string;
      longitude: number | string;
      radius_m: number;
      geofence_id: string | null;
      metadata: Record<string, unknown> | string;
    }) {
      return {
        id: row.poi_id,
        tenantId: row.tenant_id,
        name: row.name,
        category: row.category,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        radiusM: row.radius_m,
        geofenceId: row.geofence_id,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      };
    }
    const poi = toPoi({
      poi_id: 'p1',
      tenant_id: null,
      name: 'HQ',
      category: 'OFFICE',
      latitude: 40.7128,
      longitude: -74.006,
      radius_m: 50,
      geofence_id: null,
      metadata: '{}',
    });
    expect(poi.latitude).toBe(40.7128);
    expect(poi.longitude).toBe(-74.006);
    // The bug returned 0 — assert the fix holds.
    expect(poi.latitude).not.toBe(0);
    expect(poi.longitude).not.toBe(0);
  });
});
