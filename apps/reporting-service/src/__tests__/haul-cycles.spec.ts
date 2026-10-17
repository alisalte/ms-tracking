import { describe, expect, it } from '@jest/globals';
import {
  type Zone,
  detectHaulCycles,
  shiftKey,
  summarizeHauls,
  zoneContains,
} from '../domain/haul-cycles.js';

const origin: Zone = {
  kind: 'polygon',
  ring: [
    [51, 35],
    [51.01, 35],
    [51.01, 35.01],
    [51, 35.01],
  ],
};
const destination: Zone = {
  kind: 'polygon',
  ring: [
    [51.05, 35.05],
    [51.06, 35.05],
    [51.06, 35.06],
    [51.05, 35.06],
  ],
};

const at = (iso: string) => new Date(iso);

describe('haul cycles', () => {
  it('counts a load when a truck leaves the origin and reaches the destination', () => {
    const tracks = new Map([
      [
        'truck-1',
        [
          { at: at('2026-06-01T06:00:00Z'), lat: 35.02, lng: 51.02 },
          { at: at('2026-06-01T06:05:00Z'), lat: 35.005, lng: 51.005 },
          { at: at('2026-06-01T06:12:00Z'), lat: 35.004, lng: 51.004 },
          { at: at('2026-06-01T06:20:00Z'), lat: 35.03, lng: 51.03 },
          { at: at('2026-06-01T06:35:00Z'), lat: 35.055, lng: 51.055 },
        ],
      ],
      ['shovel-1', [{ at: at('2026-06-01T06:08:00Z'), lat: 35.005, lng: 51.006 }]],
    ]);
    const { cycles, open } = detectHaulCycles({
      trucks: ['truck-1'],
      shovels: ['shovel-1'],
      tracks,
      origin,
      destination,
      drivers: [
        {
          vehicleId: 'truck-1',
          driverId: 'drv-1',
          driverName: 'Ali',
          startedAt: at('2026-06-01T05:00:00Z'),
          endedAt: null,
        },
      ],
      shiftStartHour: 6,
      shiftDurationHours: 12,
      timeZone: 'UTC',
    });
    expect(open).toEqual([]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toMatchObject({
      vehicleId: 'truck-1',
      shovelId: 'shovel-1',
      driverId: 'drv-1',
      driverName: 'Ali',
      loadDwellSec: 15 * 60,
      travelSec: 15 * 60,
    });
    expect(cycles[0]?.distanceM).toBeGreaterThan(1000);
    expect(cycles[0]?.shift).toBe('2026-06-01 06:00');
    const summary = summarizeHauls(cycles);
    expect(summary.byDriverShift[0]).toMatchObject({ driverName: 'Ali', services: 1 });
    expect(summary.byShovel).toEqual([{ shovelId: 'shovel-1', loads: 1 }]);
  });

  it('keeps a truck that is still hauling as an open service', () => {
    const { cycles, open } = detectHaulCycles({
      trucks: ['truck-1'],
      shovels: [],
      tracks: new Map([
        [
          'truck-1',
          [
            { at: at('2026-06-01T06:00:00Z'), lat: 35.005, lng: 51.005 },
            { at: at('2026-06-01T06:10:00Z'), lat: 35.03, lng: 51.03 },
          ],
        ],
      ]),
      origin,
      destination,
      drivers: [],
      shiftStartHour: 6,
      shiftDurationHours: 12,
      timeZone: 'UTC',
    });
    expect(cycles).toEqual([]);
    expect(open).toEqual([
      { vehicleId: 'truck-1', phase: 'HAULING', since: at('2026-06-01T06:10:00Z') },
    ]);
  });

  it('counts two dumps and ignores a shovel that never sat in the origin', () => {
    const load = (enter: string, leave: string, dump: string) => [
      { at: at(enter), lat: 35.005, lng: 51.005 },
      { at: at(leave), lat: 35.03, lng: 51.03 },
      { at: at(dump), lat: 35.055, lng: 51.055 },
    ];
    const { cycles } = detectHaulCycles({
      trucks: ['truck-1'],
      shovels: ['shovel-far'],
      tracks: new Map([
        [
          'truck-1',
          [
            ...load('2026-06-01T06:00:00Z', '2026-06-01T06:10:00Z', '2026-06-01T06:25:00Z'),
            ...load('2026-06-01T07:00:00Z', '2026-06-01T07:10:00Z', '2026-06-01T07:30:00Z'),
          ],
        ],
        ['shovel-far', [{ at: at('2026-06-01T06:05:00Z'), lat: 34, lng: 50 }]],
      ]),
      origin,
      destination,
      drivers: [],
      shiftStartHour: 6,
      shiftDurationHours: 12,
      timeZone: 'UTC',
    });
    expect(cycles).toHaveLength(2);
    expect(cycles.every((c) => c.shovelId === null)).toBe(true);
    expect(summarizeHauls(cycles).byVehicle[0]?.services).toBe(2);
  });

  it('treats a circle zone by radius', () => {
    expect(zoneContains(35, 51, { kind: 'circle', lat: 35, lng: 51, radiusM: 50 })).toBe(true);
    expect(zoneContains(35.01, 51, { kind: 'circle', lat: 35, lng: 51, radiusM: 50 })).toBe(false);
  });

  it('labels a night shift that crosses midnight', () => {
    expect(shiftKey(at('2026-06-02T01:00:00Z'), 18, 12, 'UTC')).toBe('2026-06-01 18:00');
    expect(shiftKey(at('2026-06-01T12:00:00Z'), 18, 12, 'UTC')).toBe('off-shift');
  });
});
