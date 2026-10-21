import { describe, expect, it } from '@jest/globals';
import type { HaulCycle } from '../domain/haul-cycles.js';
import { periodOf, periodsBetween, summarizePeriods } from '../domain/haul-periods.js';

function cycle(over: Partial<HaulCycle>): HaulCycle {
  const at = new Date('2026-10-21T08:00:00Z');
  return {
    vehicleId: 'v1',
    shovelId: null,
    driverId: 'd1',
    driverName: 'Ali',
    driverSource: 'ROSTER',
    originEnteredAt: at,
    originLeftAt: at,
    destinationEnteredAt: at,
    loadDwellSec: 60,
    travelSec: 120,
    durationSec: 180,
    distanceM: 1000,
    shift: '2026-10-21#1',
    shiftDate: '2026-10-21',
    shiftNo: 1,
    ...over,
  };
}

describe('haul periods', () => {
  it('weeks run Saturday to Friday', () => {
    // 2026-10-21 is a Wednesday → the week started on Saturday 2026-10-17.
    expect(periodOf('2026-10-21', 'weekly')).toEqual({
      key: '2026-10-17',
      from: '2026-10-17',
      to: '2026-10-23',
    });
    expect(periodOf('2026-10-17', 'weekly').key).toBe('2026-10-17');
    expect(periodOf('2026-10-23', 'weekly').key).toBe('2026-10-17');
    expect(periodOf('2026-10-24', 'weekly').key).toBe('2026-10-24');
  });

  it('months follow the Jalali calendar by default', () => {
    // 2026-10-21 = 29 Mehr 1405; Mehr has 30 days (23 Sep → 22 Oct 2026).
    expect(periodOf('2026-10-21', 'monthly')).toEqual({
      key: '1405-07',
      from: '2026-09-23',
      to: '2026-10-22',
    });
    expect(periodOf('2026-10-23', 'monthly').key).toBe('1405-08');
  });

  it('months can follow the Gregorian calendar', () => {
    expect(periodOf('2026-02-10', 'monthly', 'gregorian')).toEqual({
      key: '2026-02',
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('lists quiet periods too', () => {
    expect(periodsBetween('2026-10-19', '2026-10-21', 'daily').map((p) => p.key)).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
    ]);
    expect(periodsBetween('2026-10-10', '2026-10-24', 'weekly').map((p) => p.key)).toEqual([
      '2026-10-10',
      '2026-10-17',
      '2026-10-24',
    ]);
  });

  it('rolls services up per period and per vehicle, shift and driver', () => {
    const cycles = [
      cycle({}),
      cycle({ shiftNo: 2, driverId: 'd2', driverName: 'Reza', shift: '2026-10-21#2' }),
      cycle({ driverId: null, driverName: null, driverSource: null }),
      cycle({ shiftDate: '2026-10-20', shift: '2026-10-20#1' }),
    ];
    const periods = periodsBetween('2026-10-20', '2026-10-21', 'daily');
    const out = summarizePeriods(cycles, periods, (c) => c.shiftDate ?? '', 'daily');
    expect(
      out.periods.map((p) => [p.key, p.services, p.trucks, p.drivers, p.withoutDriver]),
    ).toEqual([
      ['2026-10-20', 1, 1, 1, 0],
      ['2026-10-21', 3, 1, 2, 1],
    ]);
    expect(out.periods[1]?.distanceM).toBe(3000);
    const day = out.details.filter((d) => d.period === '2026-10-21');
    expect(day.map((d) => [d.shiftNo, d.driverId, d.services])).toEqual([
      [1, 'd1', 1],
      [1, null, 1],
      [2, 'd2', 1],
    ]);
  });

  it('weekly roll-up merges the days of the week', () => {
    const cycles = [cycle({}), cycle({ shiftDate: '2026-10-18' })];
    const periods = periodsBetween('2026-10-17', '2026-10-23', 'weekly');
    const out = summarizePeriods(cycles, periods, (c) => c.shiftDate ?? '', 'weekly');
    expect(out.periods).toHaveLength(1);
    expect(out.periods[0]?.services).toBe(2);
  });
});
