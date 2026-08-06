import { describe, expect, it } from '@jest/globals';
import { filteredDistanceStep, haversineMeters } from '../domain/trip/haversine.js';

const OPTS = { dedupeDistanceM: 1, maxPlausibleSpeedKmh: 300 };

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMeters(22.9, 113.4, 22.9, 113.4)).toBe(0);
  });

  it('computes a known distance (~1km) within tolerance', () => {
    // Two points ~1.1km apart (0.01 degree lat ≈ 1.11km).
    const d = haversineMeters(22.9, 113.4, 22.91, 113.4);
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1200);
  });

  it('is symmetric', () => {
    const a = haversineMeters(22.9, 113.4, 23.0, 113.5);
    const b = haversineMeters(23.0, 113.5, 22.9, 113.4);
    expect(a).toBeCloseTo(b, 1);
  });
});

describe('filteredDistanceStep', () => {
  const t0 = new Date('2026-08-06T10:00:00Z');
  const t1 = new Date('2026-08-06T10:00:10Z'); // 10s later

  it('returns the haversine distance for a normal moving step', () => {
    const d = filteredDistanceStep(22.9, 113.4, 22.9001, 113.4, t0, t1, 30, OPTS);
    expect(d).toBeGreaterThan(5); // ~11m
  });

  it('returns 0 for a stationary previous position (stop-zeroing)', () => {
    const d = filteredDistanceStep(22.9, 113.4, 22.9001, 113.4, t0, t1, 0, OPTS);
    expect(d).toBe(0);
  });

  it('returns 0 for a sub-threshold step (dedupe filter)', () => {
    // A tiny step (< 1m dedupe threshold) with a moving prev speed.
    const d = filteredDistanceStep(22.9, 113.4, 22.9000001, 113.4, t0, t1, 30, OPTS);
    expect(d).toBe(0);
  });

  it('returns 0 for an implausible jump (max-speed filter)', () => {
    // A huge step in a short time → implies >300km/h.
    const t1fast = new Date('2026-08-06T10:00:01Z'); // 1s
    const d = filteredDistanceStep(22.9, 113.4, 23.5, 114.0, t0, t1fast, 30, OPTS);
    expect(d).toBe(0);
  });
});
