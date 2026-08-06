import { describe, expect, it } from '@jest/globals';
import {
  aggregateToClusters,
  cellToLatLng,
  latLngToCell,
  zoomToResolution,
} from '../domain/h3-utils.js';

describe('zoomToResolution (08 §3.3)', () => {
  it('maps zoom 0 to resolution 0', () => {
    expect(zoomToResolution(0)).toBe(0);
  });
  it('maps higher zoom to higher resolution', () => {
    expect(zoomToResolution(12)).toBeGreaterThan(zoomToResolution(4));
  });
  it('clamps to [0, 15]', () => {
    expect(zoomToResolution(-1)).toBe(0);
    expect(zoomToResolution(100)).toBeLessThanOrEqual(15);
  });
});

describe('latLngToCell + cellToLatLng', () => {
  it('produces the same cell for nearby points at the same resolution', () => {
    const a = latLngToCell(22.9, 113.4, 6);
    const b = latLngToCell(22.9001, 113.4001, 6);
    expect(a).toBe(b);
  });

  it('produces different cells for distant points', () => {
    const a = latLngToCell(22.9, 113.4, 6);
    const b = latLngToCell(35.0, -100.0, 6);
    expect(a).not.toBe(b);
  });

  it('round-trips through cellToLatLng to within the grid cell', () => {
    const cellId = latLngToCell(22.9, 113.4, 6);
    const { lat, lng } = cellToLatLng(cellId);
    // The centroid should be within one grid cell of the input. At resolution 6,
    // the quantized grid has 64 divisions per axis → ~2.8° per cell.
    expect(Math.abs(lat - 22.9)).toBeLessThan(3);
    expect(Math.abs(lng - 113.4)).toBeLessThan(3);
  });
});

describe('aggregateToClusters (08 §6.3)', () => {
  it('groups nearby points into clusters', () => {
    const points = [
      { lat: 22.9, lng: 113.4 },
      { lat: 22.9001, lng: 113.4001 },
      { lat: 22.9002, lng: 113.4002 },
      { lat: 35.0, lng: -100.0 }, // distant
    ];
    const clusters = aggregateToClusters(points, 6, 100);
    expect(clusters.length).toBe(2); // two groups
  });

  it('respects the maxMarkers cap', () => {
    const points = Array.from({ length: 50 }, (_, i) => ({
      lat: 22.9 + i * 0.5, // spread far enough for separate cells
      lng: 113.4 + i * 0.5,
    }));
    const clusters = aggregateToClusters(points, 6, 10);
    expect(clusters.length).toBeLessThanOrEqual(10);
  });

  it('returns empty for empty input', () => {
    expect(aggregateToClusters([], 6, 100)).toHaveLength(0);
  });

  it('counts points correctly per cluster', () => {
    const points = [
      { lat: 22.9, lng: 113.4 },
      { lat: 22.9, lng: 113.4 },
      { lat: 22.9, lng: 113.4 },
    ];
    const clusters = aggregateToClusters(points, 6, 100);
    expect(clusters[0]?.count).toBe(3);
  });
});
