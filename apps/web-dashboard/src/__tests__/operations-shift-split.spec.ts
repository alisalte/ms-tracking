import { describe, expect, it } from 'vitest';

import type { HaulCycleReport, HaulCycleRow } from '@/api/operations.api';
import { i18n } from '@/i18n';
import { haulSheets, servicesByVehicleShift, shiftBuckets } from '@/lib/operations-export';

const cycle = (vehicleId: string, shiftNo: number): HaulCycleRow => ({
  vehicleId,
  vehicleName: `Komatsu ${vehicleId}`,
  shovelId: null,
  shovelLabel: null,
  driverId: null,
  driverName: null,
  driverSource: null,
  originEnteredAt: '2026-11-11T05:00:00Z',
  originLeftAt: '2026-11-11T05:05:00Z',
  destinationEnteredAt: '2026-11-11T05:07:00Z',
  loadDwellSec: 300,
  travelSec: 120,
  durationSec: 420,
  distanceKm: 0.4,
  shift: shiftNo > 0 ? `2026-11-11#${shiftNo}` : 'off-shift',
  shiftDate: shiftNo > 0 ? '2026-11-11' : null,
  shiftNo,
});

/** Day route 07:00 + 12 h, one shift: truck 708 also works the evening (off-shift). */
const report = (cycles: HaulCycleRow[], shiftCount = 1): HaulCycleReport =>
  ({
    route: {
      id: 'r1',
      name: 'Day shift',
      shiftStartHour: 7,
      shiftStartMinute: 0,
      shiftDurationHours: 12,
      shiftDurationMinutes: 0,
      shiftCount,
      timeZone: 'Asia/Tehran',
    },
    from: '2026-11-11T03:30:00Z',
    to: '2026-11-12T03:30:00Z',
    truncated: false,
    services: cycles.length,
    distanceKm: 0,
    cycles,
    byVehicle: [...new Set(cycles.map((c) => c.vehicleId))].map((id) => ({
      vehicleId: id,
      vehicleName: `Komatsu ${id}`,
      services: cycles.filter((c) => c.vehicleId === id).length,
      distanceKm: 0,
      durationSec: 0,
    })),
    byDriverShift: [],
    byShift: [],
    byShovel: [],
    openHauls: [],
    unbound: [],
  }) as HaulCycleReport;

const t = i18n.getFixedT('en');

describe('services split by shift', () => {
  const day = [
    ...Array.from({ length: 22 }, () => cycle('708', 1)),
    ...Array.from({ length: 17 }, () => cycle('708', 0)),
    ...Array.from({ length: 27 }, () => cycle('701', 1)),
  ];

  it('labels each shift with its clock window from the route, then off-shift', () => {
    expect(shiftBuckets(report(day), t, 'en')).toEqual([
      { no: 1, label: 'Shift 1 (07:00–19:00)' },
      { no: 0, label: 'Off shift' },
    ]);
  });

  it('lists every defined shift, even one with no services, and no off-shift when empty', () => {
    expect(shiftBuckets(report([cycle('701', 1)], 2), t, 'en')).toEqual([
      { no: 1, label: 'Shift 1 (07:00–19:00)' },
      { no: 2, label: 'Shift 2 (19:00–07:00)' },
    ]);
  });

  it('writes the clock in Persian digits for the Persian UI', () => {
    const fa = i18n.getFixedT('fa');
    expect(shiftBuckets(report([cycle('701', 1)]), fa, 'fa')[0]?.label).toBe(
      'شیفت 1 (۰۷:۰۰–۱۹:۰۰)',
    );
  });

  it('counts each truck per shift', () => {
    const split = servicesByVehicleShift(report(day));
    expect(split.get('708')).toEqual({ 1: 22, 0: 17 });
    expect(split.get('701')).toEqual({ 1: 27 });
  });

  it('puts the per-shift counts in the summary and per-machine sheets', () => {
    const [summary, , byVehicle] = haulSheets(report(day), t, 'en');
    expect(summary?.rows).toContainEqual(['Services · Shift 1 (07:00–19:00)', 49]);
    expect(summary?.rows).toContainEqual(['Services · Off shift', 17]);
    expect(summary?.rows).toContainEqual(['Total services', 66]);
    expect(byVehicle?.rows[0]?.slice(0, 4)).toEqual([
      'Machine',
      'Shift 1 (07:00–19:00)',
      'Off shift',
      'Total services',
    ]);
    expect(byVehicle?.rows[1]?.slice(0, 4)).toEqual(['Komatsu 708', 22, 17, 39]);
    expect(byVehicle?.rows[2]?.slice(0, 4)).toEqual(['Komatsu 701', 27, 0, 27]);
  });
});
