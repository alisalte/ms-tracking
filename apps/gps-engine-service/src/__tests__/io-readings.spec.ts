import { describe, expect, it } from '@jest/globals';
import { FUEL_FRESH_MS, ioReadings } from '../domain/io-readings.js';
import type { FmbIoPanel } from '../infrastructure/cache/fmb-io-memory.js';

const fix = new Date('2026-11-18T22:35:00.000Z');

describe('ioReadings', () => {
  it('keeps analog volts and fuel levels reported with the fix', () => {
    const panel: FmbIoPanel = {
      updatedAt: fix.toISOString(),
      groups: {
        ain: [
          { id: 9, key: 'ain1', group: 'ain', value: 2.424, unit: 'V', at: fix.toISOString() },
          { id: 10, key: 'ain2', group: 'ain', value: 0.008, unit: 'V', at: fix.toISOString() },
        ],
        serial: [
          { id: 201, key: 'lls1Level', group: 'serial', value: 300, at: fix.toISOString() },
          { id: 202, key: 'lls1Temp', group: 'serial', value: 21, at: fix.toISOString() },
        ],
        can: [
          { id: 84, key: 'canFuelLevelL', group: 'can', value: 141.2, at: fix.toISOString() },
          { id: 89, key: 'canFuelLevelPct', group: 'can', value: 47, at: fix.toISOString() },
        ],
        din: [{ id: 1, key: 'din1', group: 'din', value: true, at: fix.toISOString() }],
      },
    };
    expect(ioReadings(panel, fix)).toEqual({
      analog: { ain1: 2.424, ain2: 0.008 },
      fuel: { lls1Level: 300, canFuelLevelL: 141.2, canFuelLevelPct: 47 },
    });
  });

  it('drops an analog point older than the fix but keeps a fuel level within its wider window', () => {
    const panel: FmbIoPanel = {
      updatedAt: fix.toISOString(),
      groups: {
        ain: [
          {
            id: 9,
            key: 'ain1',
            group: 'ain',
            value: 2.424,
            at: new Date(fix.getTime() - 5 * 60_000).toISOString(),
          },
        ],
        can: [
          {
            id: 89,
            key: 'canFuelLevelPct',
            group: 'can',
            value: 47,
            at: new Date(fix.getTime() - 10 * 60_000).toISOString(),
          },
        ],
      },
    };
    expect(ioReadings(panel, fix)).toEqual({ fuel: { canFuelLevelPct: 47 } });

    const stale: FmbIoPanel = {
      updatedAt: fix.toISOString(),
      groups: {
        can: [
          {
            id: 89,
            key: 'canFuelLevelPct',
            group: 'can',
            value: 47,
            at: new Date(fix.getTime() - FUEL_FRESH_MS - 1).toISOString(),
          },
        ],
      },
    };
    expect(ioReadings(stale, fix)).toBeNull();
  });

  it('returns null without a panel', () => {
    expect(ioReadings(undefined, fix)).toBeNull();
    expect(ioReadings(null, fix)).toBeNull();
  });
});
