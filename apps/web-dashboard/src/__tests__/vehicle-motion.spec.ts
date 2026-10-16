import { describe, expect, it } from 'vitest';

import {
  MOTION_FRESH_MS,
  deriveVehicleMotion,
  presenceFromLiveFix,
} from '@/lib/vehicle-motion';

describe('deriveVehicleMotion', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');

  it('never shows driving while OFFLINE — even with leftover speed', () => {
    const m = deriveVehicleMotion({
      presence: 'OFFLINE',
      speedKph: 64,
      capturedAt: new Date(now).toISOString(),
      nowMs: now,
    });
    expect(m).toEqual({ state: 'offline', speed: 0, presence: 'OFFLINE' });
  });

  it('shows driving only while ONLINE and the fix is fresh', () => {
    const m = deriveVehicleMotion({
      presence: 'ONLINE',
      speedKph: 55,
      capturedAt: new Date(now - 30_000).toISOString(),
      nowMs: now,
    });
    expect(m.state).toBe('driving');
    expect(m.speed).toBe(55);
  });

  it('ages out motion so a stale high speed is not "در حرکت"', () => {
    const m = deriveVehicleMotion({
      presence: 'ONLINE',
      speedKph: 55,
      capturedAt: new Date(now - MOTION_FRESH_MS - 1_000).toISOString(),
      nowMs: now,
    });
    expect(m.state).toBe('idle');
    expect(m.speed).toBe(0);
    expect(m.presence).toBe('ONLINE');
  });

  it('maps STALE to stopped with zero speed', () => {
    const m = deriveVehicleMotion({
      presence: 'STALE',
      speedKph: 40,
      capturedAt: new Date(now).toISOString(),
      nowMs: now,
    });
    expect(m).toEqual({ state: 'stopped', speed: 0, presence: 'STALE' });
  });
});

describe('presenceFromLiveFix', () => {
  it('upgrades OFFLINE/STALE when a fresh live fix arrives', () => {
    expect(presenceFromLiveFix('OFFLINE', true)).toBe('ONLINE');
    expect(presenceFromLiveFix('STALE', true)).toBe('ONLINE');
  });

  it('keeps the current presence when there is no fresh fix', () => {
    expect(presenceFromLiveFix('OFFLINE', false)).toBe('OFFLINE');
    expect(presenceFromLiveFix(undefined, false)).toBe('UNKNOWN');
  });
});
