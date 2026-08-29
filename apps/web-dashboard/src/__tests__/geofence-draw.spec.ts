import { describe, expect, it } from 'vitest';

import {
  circleDrawCollection,
  circleToPolygonRing,
  haversineMeters,
  parseCircleRadiusM,
  radiusHandleLngLat,
  ringSelfIntersects,
  zoomForCircleRadius,
} from '@/components/geofences/GeofenceDrawMap';
import { ringCentroid } from '@/lib/geofence-geo';

describe('circleToPolygonRing', () => {
  it('spans the requested radius instead of collapsing to a point', () => {
    const ring = circleToPolygonRing(35.7, 51.4, 500);
    expect(ring.length).toBe(49);
    const first = ring[0];
    const last = ring[ring.length - 1];
    expect(first?.[0]).toBeCloseTo(last?.[0] ?? 0, 8);
    expect(first?.[1]).toBeCloseTo(last?.[1] ?? 0, 8);

    const north = ring.reduce((m, p) => Math.max(m, p[1] ?? 0), -90);
    const south = ring.reduce((m, p) => Math.min(m, p[1] ?? 0), 90);
    const diameterM = (north - south) * 111_320;
    expect(diameterM).toBeGreaterThan(950);
    expect(diameterM).toBeLessThan(1050);
  });

  it('places the radius handle one radius east of the center', () => {
    const [lng, lat] = radiusHandleLngLat(35.7, 51.4, 1000);
    expect(lat).toBeCloseTo(35.7, 8);
    expect(haversineMeters(35.7, 51.4, lat, lng)).toBeGreaterThan(990);
    expect(haversineMeters(35.7, 51.4, lat, lng)).toBeLessThan(1010);
  });
});

describe('ringSelfIntersects', () => {
  it('accepts a simple triangle', () => {
    expect(
      ringSelfIntersects([
        [51.3, 35.7],
        [51.4, 35.7],
        [51.35, 35.8],
        [51.3, 35.7],
      ]),
    ).toBe(false);
  });

  it('flags a bow-tie that PostGIS would reject as Self-intersection', () => {
    expect(
      ringSelfIntersects([
        [51.3, 35.7],
        [51.4, 35.8],
        [51.4, 35.7],
        [51.3, 35.8],
      ]),
    ).toBe(true);
  });
});

describe('parseCircleRadiusM', () => {
  it('rejects empty, zero, and non-finite values so no circle is drawn', () => {
    expect(parseCircleRadiusM(0)).toBeNull();
    expect(parseCircleRadiusM(Number.NaN)).toBeNull();
    expect(parseCircleRadiusM(-20)).toBeNull();
    expect(parseCircleRadiusM(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('keeps a positive radius in meters without clamping', () => {
    expect(parseCircleRadiusM(500)).toBe(500);
    expect(parseCircleRadiusM(3)).toBe(3);
  });
});

describe('circleDrawCollection', () => {
  it('emits one polygon ring whose diameter matches the radius in meters', () => {
    const fc = circleDrawCollection(35.7, 51.4, 500);
    const poly = fc.features[0];
    expect(poly?.geometry.type).toBe('Polygon');
    const ring = poly?.geometry.type === 'Polygon' ? poly.geometry.coordinates[0] : [];
    const north = ring.reduce((m, p) => Math.max(m, p?.[1] ?? 0), -90);
    const south = ring.reduce((m, p) => Math.min(m, p?.[1] ?? 0), 90);
    expect((north - south) * 111_320).toBeGreaterThan(950);
    expect((north - south) * 111_320).toBeLessThan(1050);
    expect(fc.features).toHaveLength(2);
    expect(poly?.properties).toMatchObject({ overlay: 'selection' });
  });
});

describe('zoomForCircleRadius', () => {
  it('zooms in far enough that a 500 m circle is not a few pixels', () => {
    const z = zoomForCircleRadius(500, 35.7, 360);
    expect(z).toBeGreaterThan(13);
    expect(z).toBeLessThan(17);
  });
});

describe('ringCentroid', () => {
  it('averages vertices and ignores the closing duplicate', () => {
    const [lng, lat] = ringCentroid([
      [51, 35],
      [53, 35],
      [53, 37],
      [51, 37],
      [51, 35],
    ]);
    expect(lng).toBeCloseTo(52);
    expect(lat).toBeCloseTo(36);
  });
});
