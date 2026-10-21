/**
 * Daily / weekly / monthly roll-ups of mine haul services.
 *
 * Cycles already carry the work day they belong to (`shiftDate`, a local
 * `YYYY-MM-DD`), so a period is just a bucket of work days:
 *   - daily   one work day
 *   - weekly  Saturday → Friday, the Iranian working week
 *   - monthly a Jalali month (default) or a Gregorian month
 * Every period inside the window is listed, including the ones with no
 * service, so a quiet day shows as zero instead of disappearing.
 */
import type { HaulCycle } from './haul-cycles.js';

export const PERIOD_GRANULARITIES = ['daily', 'weekly', 'monthly'] as const;
export type PeriodGranularity = (typeof PERIOD_GRANULARITIES)[number];

export const PERIOD_CALENDARS = ['jalali', 'gregorian'] as const;
export type PeriodCalendar = (typeof PERIOD_CALENDARS)[number];

const DAY_MS = 86_400_000;

export interface PeriodBounds {
  /** Stable sort key: `2026-10-21`, `2026-10-17`, `1405-07`, `2026-10`. */
  readonly key: string;
  /** First and last local work day of the period (`YYYY-MM-DD`, inclusive). */
  readonly from: string;
  readonly to: string;
}

export interface PeriodTotals {
  readonly key: string;
  readonly from: string;
  readonly to: string;
  readonly services: number;
  readonly distanceM: number;
  readonly durationSec: number;
  readonly loadDwellSec: number;
  readonly trucks: number;
  readonly drivers: number;
  readonly withoutDriver: number;
}

export interface PeriodDetail {
  readonly period: string;
  readonly vehicleId: string;
  readonly shiftNo: number;
  readonly driverId: string | null;
  readonly driverName: string | null;
  readonly services: number;
  readonly distanceM: number;
  readonly durationSec: number;
  readonly loadDwellSec: number;
}

function parseDate(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function jalaliParts(ms: number): { year: number; month: number; day: number } {
  const bag: Record<string, number> = {};
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(new Date(ms));
  for (const part of parts) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
      bag[part.type] = Number(part.value);
    }
  }
  return { year: bag.year ?? 0, month: bag.month ?? 0, day: bag.day ?? 0 };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The period a local work day falls into. */
export function periodOf(
  date: string,
  granularity: PeriodGranularity,
  calendar: PeriodCalendar = 'jalali',
): PeriodBounds {
  const ms = parseDate(date);
  if (granularity === 'daily') return { key: date, from: date, to: date };
  if (granularity === 'weekly') {
    // getUTCDay: Sunday 0 … Saturday 6. Saturday starts the week.
    const back = (new Date(ms).getUTCDay() + 1) % 7;
    const start = ms - back * DAY_MS;
    return { key: formatDate(start), from: formatDate(start), to: formatDate(start + 6 * DAY_MS) };
  }
  if (calendar === 'gregorian') {
    const d = new Date(ms);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    return {
      key: `${year}-${pad(month + 1)}`,
      from: formatDate(Date.UTC(year, month, 1)),
      to: formatDate(Date.UTC(year, month + 1, 0)),
    };
  }
  const today = jalaliParts(ms);
  const start = ms - (today.day - 1) * DAY_MS;
  let end = ms;
  while (jalaliParts(end + DAY_MS).month === today.month) end += DAY_MS;
  return { key: `${today.year}-${pad(today.month)}`, from: formatDate(start), to: formatDate(end) };
}

/** Every period that touches `[fromDate, toDate]`, oldest first. */
export function periodsBetween(
  fromDate: string,
  toDate: string,
  granularity: PeriodGranularity,
  calendar: PeriodCalendar = 'jalali',
): PeriodBounds[] {
  const out: PeriodBounds[] = [];
  const seen = new Set<string>();
  const last = parseDate(toDate);
  for (let ms = parseDate(fromDate); ms <= last; ms += DAY_MS) {
    const bounds = periodOf(formatDate(ms), granularity, calendar);
    if (seen.has(bounds.key)) continue;
    seen.add(bounds.key);
    out.push(bounds);
  }
  return out;
}

/** Work day of a cycle, falling back to the local date it started on when off-shift. */
export type CycleDay = (cycle: HaulCycle) => string;

export function summarizePeriods(
  cycles: readonly HaulCycle[],
  periods: readonly PeriodBounds[],
  dayOf: CycleDay,
  granularity: PeriodGranularity,
  calendar: PeriodCalendar = 'jalali',
): { periods: PeriodTotals[]; details: PeriodDetail[] } {
  const totals = new Map<
    string,
    {
      bounds: PeriodBounds;
      services: number;
      distanceM: number;
      durationSec: number;
      loadDwellSec: number;
      trucks: Set<string>;
      drivers: Set<string>;
      withoutDriver: number;
    }
  >();
  for (const bounds of periods) {
    totals.set(bounds.key, {
      bounds,
      services: 0,
      distanceM: 0,
      durationSec: 0,
      loadDwellSec: 0,
      trucks: new Set(),
      drivers: new Set(),
      withoutDriver: 0,
    });
  }
  const details = new Map<string, PeriodDetail>();
  for (const cycle of cycles) {
    const bounds = periodOf(dayOf(cycle), granularity, calendar);
    const row = totals.get(bounds.key);
    if (!row) continue;
    row.services += 1;
    row.distanceM += cycle.distanceM;
    row.durationSec += cycle.durationSec;
    row.loadDwellSec += cycle.loadDwellSec;
    row.trucks.add(cycle.vehicleId);
    if (cycle.driverId) row.drivers.add(cycle.driverId);
    else row.withoutDriver += 1;

    const detailKey = [bounds.key, cycle.vehicleId, cycle.shiftNo, cycle.driverId ?? ''].join('|');
    const prev = details.get(detailKey);
    details.set(detailKey, {
      period: bounds.key,
      vehicleId: cycle.vehicleId,
      shiftNo: cycle.shiftNo,
      driverId: cycle.driverId,
      driverName: cycle.driverName,
      services: (prev?.services ?? 0) + 1,
      distanceM: (prev?.distanceM ?? 0) + cycle.distanceM,
      durationSec: (prev?.durationSec ?? 0) + cycle.durationSec,
      loadDwellSec: (prev?.loadDwellSec ?? 0) + cycle.loadDwellSec,
    });
  }
  return {
    periods: [...totals.values()].map(({ bounds, trucks, drivers, ...row }) => ({
      key: bounds.key,
      from: bounds.from,
      to: bounds.to,
      ...row,
      trucks: trucks.size,
      drivers: drivers.size,
    })),
    details: [...details.values()].sort(
      (a, b) =>
        a.period.localeCompare(b.period) ||
        a.vehicleId.localeCompare(b.vehicleId) ||
        a.shiftNo - b.shiftNo,
    ),
  };
}
