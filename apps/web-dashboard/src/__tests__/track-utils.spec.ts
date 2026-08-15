/**
 * Track utilities tests (Sprint F §9/§10): gap splitting, invalid-point
 * filtering, redundancy dropping, and bounds computation.
 */
import { describe, expect, it } from 'vitest';

import type { TrackPoint } from '@/api/map.api';
import { segmentsBounds, splitTrackIntoSegments } from '@/lib/track-utils';

function p(vehicleId: string, minutes: number, lat: number, lng: number): TrackPoint {
  return {
    vehicleId,
    latitude: lat,
    longitude: lng,
    speedKph: 30,
    headingDeg: 90,
    capturedAt: new Date(Date.UTC(2026, 7, 15, 8, minutes)).toISOString(),
  };
}

describe('splitTrackIntoSegments', () => {
  it('keeps a continuous track as one segment', () => {
    const points = [p('v1', 0, 35.7, 51.4), p('v1', 1, 35.71, 51.41), p('v1', 2, 35.72, 51.42)];
    const segments = splitTrackIntoSegments(points);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(3);
  });

  it('splits at a temporal gap larger than the threshold (no straight-line bridging)', () => {
    const points = [
      p('v1', 0, 35.7, 51.4),
      p('v1', 1, 35.71, 51.41),
      // 30-minute gap (device offline)
      p('v1', 31, 35.9, 51.6),
      p('v1', 32, 35.91, 51.61),
    ];
    const segments = splitTrackIntoSegments(points);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual([
      [51.4, 35.7],
      [51.41, 35.71],
    ]);
    expect(segments[1]).toEqual([
      [51.6, 35.9],
      [51.61, 35.91],
    ]);
  });

  it('drops invalid coordinates and unparseable timestamps', () => {
    const points = [
      p('v1', 0, 35.7, 51.4),
      { ...p('v1', 1, 999, 51.41) }, // invalid latitude
      { ...p('v1', 2, 35.72, Number.NaN) }, // invalid longitude
      { ...p('v1', 3, 35.73, 51.43), capturedAt: 'not-a-date' },
      p('v1', 4, 35.74, 51.44),
    ];
    const segments = splitTrackIntoSegments(points);
    expect(segments).toHaveLength(1);
    // Only the two VALID points survive (the three invalid ones are dropped).
    expect(segments[0]?.length).toBe(2);
  });

  it('drops sub-threshold duplicate points (simplification)', () => {
    const points = [
      p('v1', 0, 35.7, 51.4),
      p('v1', 1, 35.70001, 51.40001), // ~1.5 m — redundant
      p('v1', 2, 35.71, 51.41), // ~1.3 km — kept
    ];
    const segments = splitTrackIntoSegments(points);
    expect(segments[0]?.length).toBe(2);
  });

  it('returns no single-point segments', () => {
    const segments = splitTrackIntoSegments([p('v1', 0, 35.7, 51.4)]);
    expect(segments).toHaveLength(0);
  });
});

describe('segmentsBounds', () => {
  it('computes the bounding box over all segments', () => {
    const bounds = segmentsBounds([
      [
        [51.4, 35.7],
        [51.5, 35.8],
      ],
      [
        [51.3, 35.9],
        [51.45, 35.75],
      ],
    ]);
    expect(bounds).toEqual({ west: 51.3, south: 35.7, east: 51.5, north: 35.9 });
  });

  it('returns null for an empty track', () => {
    expect(segmentsBounds([])).toBeNull();
  });
});
