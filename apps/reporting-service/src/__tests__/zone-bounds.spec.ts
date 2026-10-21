import { describe, expect, it } from '@jest/globals';
import { zoneBounds } from '../application/operations-report.service.js';
import { zoneContains } from '../domain/haul-cycles.js';

describe('zoneBounds', () => {
  it('wraps a polygon with a margin so no point inside it is filtered out', () => {
    const zone = {
      kind: 'polygon' as const,
      ring: [
        [51, 35],
        [51.01, 35],
        [51.01, 35.01],
        [51, 35.01],
      ] as const,
    };
    const box = zoneBounds(zone);
    expect(box.minLat).toBeLessThan(35);
    expect(box.maxLat).toBeGreaterThan(35.01);
    expect(box.minLng).toBeLessThan(51);
    expect(box.maxLng).toBeGreaterThan(51.01);
  });

  it('covers every point of a circle, including its east and north edges', () => {
    const zone = { kind: 'circle' as const, lat: 35, lng: 51, radiusM: 500 };
    const box = zoneBounds(zone);
    const east = { lat: 35, lng: 51 + 500 / (111_320 * Math.cos((35 * Math.PI) / 180)) - 1e-6 };
    const north = { lat: 35 + 500 / 111_320 - 1e-6, lng: 51 };
    for (const p of [east, north]) {
      expect(zoneContains(p.lat, p.lng, zone)).toBe(true);
      expect(p.lat).toBeGreaterThanOrEqual(box.minLat);
      expect(p.lat).toBeLessThanOrEqual(box.maxLat);
      expect(p.lng).toBeGreaterThanOrEqual(box.minLng);
      expect(p.lng).toBeLessThanOrEqual(box.maxLng);
    }
  });
});
