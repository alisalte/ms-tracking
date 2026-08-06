import { describe, expect, it } from '@jest/globals';
import { type QualityOptions, validatePosition } from '../domain/quality.js';

const OPTS: QualityOptions = { staleAfterSeconds: 300, futureThresholdSeconds: 60 };
const NOW = new Date('2026-08-06T10:00:00Z');

describe('validatePosition — quality gates (07 §3.3)', () => {
  it('accepts a valid, recent position as VALID', () => {
    const captured = new Date(NOW.getTime() - 10_000); // 10s ago
    const result = validatePosition(22.9, 113.4, captured, NOW, OPTS);
    expect(result.quality).toBe('VALID');
    expect(result.accepted).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('rejects a latitude out of range', () => {
    const result = validatePosition(95, 0, NOW, NOW, OPTS);
    expect(result.quality).toBe('REJECTED');
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/latitude/);
  });

  it('rejects a longitude out of range', () => {
    const result = validatePosition(0, 200, NOW, NOW, OPTS);
    expect(result.quality).toBe('REJECTED');
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/longitude/);
  });

  it('rejects a future-dated position beyond the threshold', () => {
    const captured = new Date(NOW.getTime() + 120_000); // 2min in future
    const result = validatePosition(22.9, 113.4, captured, NOW, OPTS);
    expect(result.quality).toBe('REJECTED');
    expect(result.reason).toMatch(/future/);
  });

  it('tags a stale position as STALE (accepted, not pushed live)', () => {
    const captured = new Date(NOW.getTime() - 600_000); // 10min ago (> 300s)
    const result = validatePosition(22.9, 113.4, captured, NOW, OPTS);
    expect(result.quality).toBe('STALE');
    expect(result.accepted).toBe(true);
    expect(result.reason).toMatch(/old/);
  });

  it('accepts negative coordinates (southern/western hemispheres)', () => {
    const captured = new Date(NOW.getTime() - 5_000);
    const result = validatePosition(-33.85, -151.21, captured, NOW, OPTS);
    expect(result.quality).toBe('VALID');
  });

  it('rejects NaN latitude', () => {
    const result = validatePosition(Number.NaN, 0, NOW, NOW, OPTS);
    expect(result.quality).toBe('REJECTED');
  });
});
