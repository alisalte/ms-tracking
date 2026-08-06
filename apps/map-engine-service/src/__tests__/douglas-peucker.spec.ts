import { describe, expect, it } from '@jest/globals';
import { simplify } from '../domain/douglas-peucker.js';

describe('simplify (Douglas-Peucker, 08 §9.3)', () => {
  it('preserves endpoints', () => {
    const points = [
      { lat: 22.9, lng: 113.4 },
      { lat: 22.91, lng: 113.41 },
      { lat: 22.92, lng: 113.42 },
    ];
    const result = simplify(points, 5);
    expect(result[0]).toEqual(points[0]);
    expect(result[result.length - 1]).toEqual(points[points.length - 1]);
  });

  it('returns all points for a polyline shorter than 2 points', () => {
    expect(simplify([{ lat: 0, lng: 0 }], 5)).toHaveLength(1);
    expect(simplify([], 5)).toHaveLength(0);
  });

  it('reduces collinear points to endpoints', () => {
    // Three points on a straight line → simplified to 2.
    const collinear = [
      { lat: 22.9, lng: 113.4 },
      { lat: 22.90001, lng: 113.40001 },
      { lat: 22.90002, lng: 113.40002 },
    ];
    const result = simplify(collinear, 5);
    expect(result.length).toBeLessThan(collinear.length);
  });

  it('preserves a significant deviation point', () => {
    // A V-shape: the middle point deviates significantly → it must be kept.
    const vShape = [
      { lat: 22.9, lng: 113.4 },
      { lat: 22.91, lng: 113.41 }, // ~1.5km off the A→C line
      { lat: 22.9, lng: 113.42 },
    ];
    const result = simplify(vShape, 5);
    expect(result).toHaveLength(3); // all 3 preserved
  });

  it('significantly reduces a dense polyline', () => {
    // 100 points along a straight line → should compress heavily.
    const dense = Array.from({ length: 100 }, (_, i) => ({
      lat: 22.9 + i * 0.000001,
      lng: 113.4 + i * 0.000001,
    }));
    const result = simplify(dense, 5);
    expect(result.length).toBeLessThan(10);
  });
});
