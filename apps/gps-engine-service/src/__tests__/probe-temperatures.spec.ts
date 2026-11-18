import { describe, expect, it } from '@jest/globals';
import { probeTemperatures } from '../domain/probe-temperatures.js';
import type { FmbIoPanel } from '../infrastructure/cache/fmb-io-memory.js';

const fix = new Date('2026-11-10T08:00:00.000Z');

describe('probeTemperatures', () => {
  it('keeps the probe readings reported with the fix', () => {
    const panel: FmbIoPanel = {
      updatedAt: fix.toISOString(),
      groups: {
        onewire: [
          { id: 72, key: 'temp1', group: 'onewire', value: 4.56, at: '2026-11-10T08:00:00.000Z' },
          { id: 78, key: 'ibutton', group: 'onewire', value: 'AB12', at: fix.toISOString() },
        ],
        serial: [
          { id: 202, key: 'lls1Temp', group: 'serial', value: 21, at: fix.toISOString() },
          { id: 201, key: 'lls1Fuel', group: 'serial', value: 300, at: fix.toISOString() },
        ],
        din: [{ id: 1, key: 'din1', group: 'din', value: true, at: fix.toISOString() }],
      },
    };
    expect(probeTemperatures(panel, fix)).toEqual({ temp1: 4.56, lls1Temp: 21 });
  });

  it('drops a reading much older than the fix (disconnected probe)', () => {
    const panel: FmbIoPanel = {
      updatedAt: fix.toISOString(),
      groups: {
        onewire: [
          { id: 72, key: 'temp1', group: 'onewire', value: 5, at: '2026-11-10T07:50:00.000Z' },
        ],
      },
    };
    expect(probeTemperatures(panel, fix)).toBeNull();
  });

  it('returns null without a panel', () => {
    expect(probeTemperatures(undefined, fix)).toBeNull();
    expect(probeTemperatures(null, fix)).toBeNull();
  });
});
