import { describe, expect, it } from '@jest/globals';
import {
  type Zone,
  detectHaulCycles,
  shiftDayWindow,
  shiftKey,
  shiftSlot,
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
    expect(cycles[0]?.shift).toBe('2026-06-01#1');
    expect(cycles[0]?.driverSource).toBe('ASSIGNMENT');
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
    expect(shiftKey(at('2026-06-02T01:00:00Z'), 18, 12, 'UTC')).toBe('2026-06-01#1');
    expect(shiftKey(at('2026-06-01T12:00:00Z'), 18, 12, 'UTC')).toBe('off-shift');
  });

  it('splits the work day into two back-to-back shifts', () => {
    expect(shiftSlot(at('2026-06-01T07:00:00Z'), 6, 12, 'UTC', 2)).toEqual({
      key: '2026-06-01#1',
      date: '2026-06-01',
      no: 1,
    });
    expect(shiftSlot(at('2026-06-01T20:00:00Z'), 6, 12, 'UTC', 2)).toEqual({
      key: '2026-06-01#2',
      date: '2026-06-01',
      no: 2,
    });
    // 03:00 next morning is still the night shift of June 1.
    expect(shiftKey(at('2026-06-02T03:00:00Z'), 6, 12, 'UTC', 2)).toBe('2026-06-01#2');
    expect(shiftKey(at('2026-06-02T06:00:00Z'), 6, 12, 'UTC', 2)).toBe('2026-06-02#1');
    // Two 8 h shifts leave a gap from 22:00 to 06:00.
    expect(shiftKey(at('2026-06-01T23:00:00Z'), 6, 8, 'UTC', 2)).toBe('off-shift');
    // Tehran is UTC+03:30: 03:00Z is 06:30 local, the day shift.
    expect(shiftKey(at('2026-06-01T03:00:00Z'), 6, 12, 'Asia/Tehran', 2)).toBe('2026-06-01#1');
  });

  it('credits the rostered driver of each shift on the same truck', () => {
    const load = (enter: string, leave: string, dump: string) => [
      { at: at(enter), lat: 35.005, lng: 51.005 },
      { at: at(leave), lat: 35.03, lng: 51.03 },
      { at: at(dump), lat: 35.055, lng: 51.055 },
    ];
    const { cycles } = detectHaulCycles({
      trucks: ['truck-1'],
      shovels: [],
      tracks: new Map([
        [
          'truck-1',
          [
            ...load('2026-06-01T08:00:00Z', '2026-06-01T08:10:00Z', '2026-06-01T08:30:00Z'),
            ...load('2026-06-01T20:00:00Z', '2026-06-01T20:10:00Z', '2026-06-01T20:30:00Z'),
            ...load('2026-06-02T02:00:00Z', '2026-06-02T02:10:00Z', '2026-06-02T02:30:00Z'),
          ],
        ],
      ]),
      origin,
      destination,
      // The assignment history still points at the day driver for the whole day.
      drivers: [
        {
          vehicleId: 'truck-1',
          driverId: 'drv-day',
          driverName: 'Day',
          startedAt: at('2026-06-01T00:00:00Z'),
          endedAt: null,
        },
      ],
      rosters: new Map([
        [
          'truck-1',
          [
            { driverId: 'drv-day', driverName: 'Day' },
            { driverId: 'drv-night', driverName: 'Night' },
          ],
        ],
      ]),
      shiftStartHour: 6,
      shiftDurationHours: 12,
      shiftCount: 2,
      timeZone: 'UTC',
    });
    expect(cycles.map((c) => [c.driverName, c.shift, c.driverSource])).toEqual([
      ['Day', '2026-06-01#1', 'ROSTER'],
      ['Night', '2026-06-01#2', 'ROSTER'],
      ['Night', '2026-06-01#2', 'ROSTER'],
    ]);
    const summary = summarizeHauls(cycles);
    expect(summary.byShift).toEqual([
      expect.objectContaining({ shift: '2026-06-01#1', services: 1, trucks: 1, drivers: 1 }),
      expect.objectContaining({ shift: '2026-06-01#2', services: 2, trucks: 1, withoutDriver: 0 }),
    ]);
    expect(summary.byDriverShift.map((r) => [r.driverName, r.services, r.vehicleIds])).toEqual([
      ['Day', 1, ['truck-1']],
      ['Night', 2, ['truck-1']],
    ]);
  });

  it('counts a service when the truck jumps from the origin straight into the destination', () => {
    const { cycles, open } = detectHaulCycles({
      trucks: ['truck-1'],
      shovels: [],
      tracks: new Map([
        [
          'truck-1',
          [
            { at: at('2026-06-01T06:00:00Z'), lat: 35.005, lng: 51.005 },
            { at: at('2026-06-01T06:10:00Z'), lat: 35.006, lng: 51.006 },
            { at: at('2026-06-01T06:30:00Z'), lat: 35.055, lng: 51.055 },
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
    expect(open).toEqual([]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toMatchObject({ loadDwellSec: 600, travelSec: 1200 });
  });

  it('keeps the loading clock through a short step outside the origin', () => {
    const { cycles } = detectHaulCycles({
      trucks: ['truck-1'],
      shovels: [],
      tracks: new Map([
        [
          'truck-1',
          [
            { at: at('2026-06-01T06:00:00Z'), lat: 35.005, lng: 51.005 },
            { at: at('2026-06-01T06:05:00Z'), lat: 35.0101, lng: 51.005 },
            { at: at('2026-06-01T06:06:00Z'), lat: 35.009, lng: 51.005 },
            { at: at('2026-06-01T06:10:00Z'), lat: 35.03, lng: 51.03 },
            { at: at('2026-06-01T06:20:00Z'), lat: 35.055, lng: 51.055 },
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
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.originEnteredAt).toEqual(at('2026-06-01T06:00:00Z'));
    expect(cycles[0]?.loadDwellSec).toBe(600);
  });

  it('aligns report presets to the work day, not UTC midnight', () => {
    // 2026-06-02 01:00 Tehran is still the night shift of June 1.
    const now = at('2026-06-01T21:30:00Z');
    expect(shiftDayWindow('today', 6, 'Asia/Tehran', now)).toEqual({
      from: at('2026-06-01T02:30:00Z'),
      to: now,
    });
    expect(shiftDayWindow('yesterday', 6, 'Asia/Tehran', now)).toEqual({
      from: at('2026-05-31T02:30:00Z'),
      to: at('2026-06-01T02:30:00Z'),
    });
    expect(shiftDayWindow('7d', 6, 'UTC', at('2026-06-08T10:00:00Z'))?.from).toEqual(
      at('2026-06-02T06:00:00Z'),
    );
    expect(shiftDayWindow('bogus', 6, 'UTC', now)).toBeNull();
  });
});

describe('haul cycles: drivers assigned per shift', () => {
  const base = {
    trucks: ['truck-1'],
    shovels: [],
    origin,
    destination,
    shiftStartHour: 6,
    shiftDurationHours: 8,
    shiftCount: 3,
    timeZone: 'UTC',
  };
  const assignment = (driverId: string, shiftNo: number | null) => ({
    vehicleId: 'truck-1',
    driverId,
    driverName: driverId,
    startedAt: at('2026-05-01T00:00:00Z'),
    endedAt: null,
    shiftNo,
  });

  it('credits the driver assigned to the shift of the service', () => {
    const drivers = [assignment('morning', 1), assignment('evening', 2), assignment('night', 3)];
    const tracks = new Map([
      [
        'truck-1',
        [
          // 06:00, 14:00 and 22:00 UTC → shifts 1, 2 and 3 of 2026-06-01.
          ...['06', '14', '22'].flatMap((hour) => [
            { at: at(`2026-06-01T${hour}:00:00Z`), lat: 35.005, lng: 51.005 },
            { at: at(`2026-06-01T${hour}:20:00Z`), lat: 35.03, lng: 51.03 },
            { at: at(`2026-06-01T${hour}:40:00Z`), lat: 35.055, lng: 51.055 },
          ]),
        ],
      ],
    ]);
    const { cycles } = detectHaulCycles({ ...base, tracks, drivers });
    expect(cycles.map((c) => [c.shiftNo, c.driverId, c.driverSource])).toEqual([
      [1, 'morning', 'ASSIGNMENT'],
      [2, 'evening', 'ASSIGNMENT'],
      [3, 'night', 'ASSIGNMENT'],
    ]);
  });

  it('falls back to the any-shift driver, and leaves an unstaffed shift empty', () => {
    const drivers = [assignment('all-day', null), assignment('night', 3)];
    const tracks = new Map([
      [
        'truck-1',
        [
          ...['06', '22'].flatMap((hour) => [
            { at: at(`2026-06-01T${hour}:00:00Z`), lat: 35.005, lng: 51.005 },
            { at: at(`2026-06-01T${hour}:20:00Z`), lat: 35.03, lng: 51.03 },
            { at: at(`2026-06-01T${hour}:40:00Z`), lat: 35.055, lng: 51.055 },
          ]),
        ],
      ],
    ]);
    const { cycles } = detectHaulCycles({ ...base, tracks, drivers });
    expect(cycles.map((c) => c.driverId)).toEqual(['all-day', 'night']);
    const alone = detectHaulCycles({
      ...base,
      tracks,
      drivers: [assignment('night', 3)],
    }).cycles;
    expect(alone.map((c) => c.driverId)).toEqual([null, 'night']);
  });
});
