/**
 * Driver and truck work per shift on one or more haul routes.
 *
 * Several routes can be read as one work day — a day-shift route and a
 * night-shift route on the same trucks, for example. Every route shift becomes
 * one window of a combined plan, and every moment belongs to at most one
 * window, so time and services are never counted twice.
 *
 * Services come from the detected haul cycles. Working time and distance come
 * from each truck's own track: every interval between two fixes belongs to the
 * shift (and the driver of that shift) at its first fix.
 *   - working  the engine is on or the truck moves (parked with the engine off,
 *              and gaps without data, are not work)
 *   - distance the GPS path while moving, without jitter or jumps
 * Off-shift time (outside every window) keeps shift 0 and the local date.
 */
import {
  type DriverContext,
  type HaulCycle,
  type RosterDriver,
  type TrackSample,
  haversineMeters,
  localDate,
  resolveDriver,
  shiftSlot,
} from './haul-cycles.js';
import { type PeriodCalendar, periodOf } from './haul-periods.js';

const STANDING_KMH = 3;
const NO_DATA_GAP_SEC = 300;
const MAX_STEP_KMH = 100;
/** A driver counts as having worked on a truck after this much engine time or one service. */
export const MIN_ACTIVE_SEC = 300;

export type ShiftKind = 'day' | 'night';

/** One route of the plan with everything needed to credit a driver. */
export interface PlanRoute {
  readonly routeId: string;
  readonly routeName: string;
  readonly ctx: DriverContext;
}

/** One shift of the combined work day. */
export interface ShiftInfo {
  /** Combined shift number, 1-based, in work-day order. */
  readonly no: number;
  /** Local start, minutes after midnight. */
  readonly startMinute: number;
  readonly durationMinutes: number;
  /** Day / night when the plan is exactly one day and one night shift. */
  readonly kind: ShiftKind | null;
  readonly routeId: string;
  readonly routeName: string;
  /** The shift number on its own route, and how many shifts that route has. */
  readonly routeShiftNo: number;
  readonly routeShiftCount: number;
}

/** Where a moment falls: the work day, the combined shift (0 = off-shift) and its driver. */
export interface ShiftAt {
  readonly day: string;
  readonly shiftNo: number;
  readonly driver: RosterDriver | null;
}

export type ShiftResolver = (vehicleId: string, at: Date) => ShiftAt;

function routeShiftCount(ctx: DriverContext): number {
  return Math.max(1, ctx.shiftCount ?? 1);
}

/**
 * Every route shift as one window, routes in the order of their first shift
 * (the work day starts with the earliest one).
 */
export function shiftPlan(routes: readonly PlanRoute[]): ShiftInfo[] {
  const windows = [...routes]
    .map((route, index) => ({ route, index, start: Math.round(route.ctx.shiftStartHour * 60) }))
    .sort((a, b) => a.start - b.start || a.index - b.index)
    .flatMap(({ route, start }) => {
      const duration = Math.round(route.ctx.shiftDurationHours * 60);
      const count = routeShiftCount(route.ctx);
      return Array.from({ length: count }, (_, i) => {
        const startMinute = (((start + i * duration) % 1440) + 1440) % 1440;
        const mid = (startMinute + duration / 2) % 1440;
        return {
          startMinute,
          durationMinutes: duration,
          kind: (mid >= 360 && mid < 1080 ? 'day' : 'night') as ShiftKind,
          routeId: route.routeId,
          routeName: route.routeName,
          routeShiftNo: i + 1,
          routeShiftCount: count,
        };
      });
    });
  // Only one day and one night shift that (nearly) cover the clock read as a
  // day / night pair; 06–14 / 14–22 does not.
  const total = windows.reduce((sum, w) => sum + w.durationMinutes, 0);
  const named = windows.length === 2 && total >= 1200 && windows[0]?.kind !== windows[1]?.kind;
  return windows.map((w, i) => ({ ...w, no: i + 1, kind: named ? w.kind : null }));
}

/** The plan as a lookup: first window (in plan order) that holds the moment wins. */
export function shiftResolver(
  routes: readonly PlanRoute[],
  plan: readonly ShiftInfo[],
  timeZone: string,
): ShiftResolver {
  const byRoute = new Map(routes.map((route) => [route.routeId, route]));
  const order = [...new Set(plan.map((w) => w.routeId))]
    .map((id) => byRoute.get(id))
    .filter((route): route is PlanRoute => Boolean(route));
  return (vehicleId, at) => {
    for (const route of order) {
      const { ctx } = route;
      const slot = shiftSlot(
        at,
        ctx.shiftStartHour,
        ctx.shiftDurationHours,
        ctx.timeZone,
        routeShiftCount(ctx),
      );
      if (slot.no === 0 || !slot.date) continue;
      const window = plan.find((w) => w.routeId === route.routeId && w.routeShiftNo === slot.no);
      if (!window) continue;
      return {
        day: slot.date,
        shiftNo: window.no,
        driver: resolveDriver(ctx, vehicleId, at).driver,
      };
    }
    const first = order[0];
    return {
      day: localDate(at, timeZone),
      shiftNo: 0,
      driver: first ? resolveDriver(first.ctx, vehicleId, at).driver : null,
    };
  };
}

/**
 * Services found on several routes (same pit, same dump) are one service:
 * keep one per truck and origin entry, credited to the shift and driver of
 * the combined plan.
 */
export function planCycles(cycles: readonly HaulCycle[], resolve: ShiftResolver): HaulCycle[] {
  const seen = new Set<string>();
  const out: HaulCycle[] = [];
  for (const cycle of cycles) {
    const key = `${cycle.vehicleId}|${cycle.originEnteredAt.getTime()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const at = resolve(cycle.vehicleId, cycle.originEnteredAt);
    out.push({
      ...cycle,
      driverId: at.driver?.driverId ?? null,
      driverName: at.driver?.driverName ?? null,
      shift: at.shiftNo > 0 ? `${at.day}#${at.shiftNo}` : 'off-shift',
      shiftDate: at.shiftNo > 0 ? at.day : null,
      shiftNo: at.shiftNo,
    });
  }
  return out.sort((a, b) => a.originEnteredAt.getTime() - b.originEnteredAt.getTime());
}

export interface WorkSlice {
  readonly vehicleId: string;
  /** Work day of the shift (`YYYY-MM-DD`); the local date when off-shift. */
  readonly day: string;
  readonly shiftNo: number;
  readonly driverId: string | null;
  readonly driverName: string | null;
  workSec: number;
  movingSec: number;
  distanceM: number;
}

/** One truck's working time and distance, split by work day, shift and driver. */
export function measureShiftWork(input: {
  readonly vehicleId: string;
  readonly samples: readonly TrackSample[];
  readonly resolve: ShiftResolver;
}): WorkSlice[] {
  const samples = [...input.samples].sort((a, b) => a.at.getTime() - b.at.getTime());
  const slices = new Map<string, WorkSlice>();
  // Shift and driver change at most once a minute in practice; resolve once per minute.
  const byMinute = new Map<number, WorkSlice>();
  const sliceAt = (at: Date): WorkSlice => {
    const minute = Math.floor(at.getTime() / 60_000);
    const cached = byMinute.get(minute);
    if (cached) return cached;
    const { day, shiftNo, driver } = input.resolve(input.vehicleId, at);
    const key = `${day}|${shiftNo}|${driver?.driverId ?? ''}`;
    let slice = slices.get(key);
    if (!slice) {
      slice = {
        vehicleId: input.vehicleId,
        day,
        shiftNo,
        driverId: driver?.driverId ?? null,
        driverName: driver?.driverName ?? null,
        workSec: 0,
        movingSec: 0,
        distanceM: 0,
      };
      slices.set(key, slice);
    }
    byMinute.set(minute, slice);
    return slice;
  };

  for (let i = 0; i + 1 < samples.length; i += 1) {
    const a = samples[i];
    const b = samples[i + 1];
    if (!a || !b) continue;
    const dt = (b.at.getTime() - a.at.getTime()) / 1000;
    if (dt <= 0 || dt > NO_DATA_GAP_SEC) continue;
    const meters = haversineMeters(a.lat, a.lng, b.lat, b.lng);
    const standing =
      typeof a.speedKmh === 'number'
        ? a.speedKmh <= STANDING_KMH
        : (meters / dt) * 3.6 <= STANDING_KMH;
    if (standing && a.ignitionOn === false) continue;
    const slice = sliceAt(a.at);
    slice.workSec += dt;
    if (!standing) {
      slice.movingSec += dt;
      if (meters >= 1 && (meters / dt) * 3.6 <= MAX_STEP_KMH) slice.distanceM += meters;
    }
  }
  return [...slices.values()];
}

export interface TruckShiftRow {
  readonly day: string;
  readonly vehicleId: string;
  readonly shiftNo: number;
  readonly services: number;
  readonly serviceDistanceM: number;
  readonly workSec: number;
  readonly movingSec: number;
  readonly distanceM: number;
  readonly driverNames: string[];
}

export interface DriverTotals {
  readonly driverId: string;
  readonly driverName: string;
  readonly services: number;
  readonly serviceDistanceM: number;
  readonly workSec: number;
  readonly movingSec: number;
  readonly distanceM: number;
  /** Work days with any activity. */
  readonly days: number;
  /** Shifts (day + shift number) with any activity. */
  readonly shifts: number;
  readonly vehicleIds: string[];
  /** Services per shift number, `{ 1: 40, 2: 35 }`. */
  readonly servicesByShift: Record<number, number>;
}

export interface DriverPeriodRow extends DriverTotals {
  readonly period: string;
  readonly from: string;
  readonly to: string;
}

export interface ShiftReport {
  readonly trucks: TruckShiftRow[];
  readonly drivers: DriverTotals[];
  readonly driverDays: DriverPeriodRow[];
  readonly driverMonths: DriverPeriodRow[];
}

interface DriverAcc {
  driverId: string;
  driverName: string;
  services: number;
  serviceDistanceM: number;
  workSec: number;
  movingSec: number;
  distanceM: number;
  days: Set<string>;
  shifts: Set<string>;
  vehicles: Map<string, { workSec: number; services: number }>;
  servicesByShift: Record<number, number>;
  period?: { key: string; from: string; to: string };
}

function newDriver(id: string, name: string): DriverAcc {
  return {
    driverId: id,
    driverName: name,
    services: 0,
    serviceDistanceM: 0,
    workSec: 0,
    movingSec: 0,
    distanceM: 0,
    days: new Set(),
    shifts: new Set(),
    vehicles: new Map(),
    servicesByShift: {},
  };
}

function finishDriver(acc: DriverAcc): DriverTotals {
  const vehicleIds = [...acc.vehicles.entries()]
    .filter(([, v]) => v.services > 0 || v.workSec >= MIN_ACTIVE_SEC)
    .map(([id]) => id);
  return {
    driverId: acc.driverId,
    driverName: acc.driverName,
    services: acc.services,
    serviceDistanceM: acc.serviceDistanceM,
    workSec: Math.round(acc.workSec),
    movingSec: Math.round(acc.movingSec),
    distanceM: acc.distanceM,
    days: acc.days.size,
    shifts: acc.shifts.size,
    vehicleIds,
    servicesByShift: acc.servicesByShift,
  };
}

const NATURAL = new Intl.Collator('fa', { numeric: true, sensitivity: 'base' });

/** Roll services and work up per truck shift, per driver, and per driver day / month. */
export function summarizeShiftReport(input: {
  cycles: readonly HaulCycle[];
  work: readonly WorkSlice[];
  timeZone: string;
  calendar?: PeriodCalendar;
}): ShiftReport {
  const calendar = input.calendar ?? 'jalali';
  type TruckAcc = { -readonly [K in keyof TruckShiftRow]: TruckShiftRow[K] } & {
    drivers: Set<string>;
  };
  const trucks = new Map<string, TruckAcc>();
  const totals = new Map<string, DriverAcc>();
  const days = new Map<string, DriverAcc>();
  const months = new Map<string, DriverAcc>();

  const truckRow = (day: string, vehicleId: string, shiftNo: number) => {
    const key = `${day}|${vehicleId}|${shiftNo}`;
    let row = trucks.get(key);
    if (!row) {
      row = {
        day,
        vehicleId,
        shiftNo,
        services: 0,
        serviceDistanceM: 0,
        workSec: 0,
        movingSec: 0,
        distanceM: 0,
        driverNames: [],
        drivers: new Set(),
      };
      trucks.set(key, row);
    }
    return row;
  };
  const driverRows = (driverId: string, driverName: string, day: string): DriverAcc[] => {
    const month = periodOf(day, 'monthly', calendar);
    const pick = (
      map: Map<string, DriverAcc>,
      key: string,
      period?: { key: string; from: string; to: string },
    ) => {
      let acc = map.get(key);
      if (!acc) {
        acc = newDriver(driverId, driverName);
        acc.period = period;
        map.set(key, acc);
      }
      return acc;
    };
    return [
      pick(totals, driverId),
      pick(days, `${day}|${driverId}`, { key: day, from: day, to: day }),
      pick(months, `${month.key}|${driverId}`, month),
    ];
  };
  const touch = (acc: DriverAcc, day: string, shiftNo: number, vehicleId: string) => {
    acc.days.add(day);
    acc.shifts.add(`${day}#${shiftNo}`);
    if (!acc.vehicles.has(vehicleId)) acc.vehicles.set(vehicleId, { workSec: 0, services: 0 });
    return acc.vehicles.get(vehicleId) as { workSec: number; services: number };
  };

  for (const cycle of input.cycles) {
    const day = cycle.shiftDate ?? localDate(cycle.originEnteredAt, input.timeZone);
    const row = truckRow(day, cycle.vehicleId, cycle.shiftNo);
    row.services += 1;
    row.serviceDistanceM += cycle.distanceM;
    if (cycle.driverName) row.drivers.add(cycle.driverName);
    if (!cycle.driverId) continue;
    for (const acc of driverRows(cycle.driverId, cycle.driverName ?? cycle.driverId, day)) {
      acc.services += 1;
      acc.serviceDistanceM += cycle.distanceM;
      acc.servicesByShift[cycle.shiftNo] = (acc.servicesByShift[cycle.shiftNo] ?? 0) + 1;
      touch(acc, day, cycle.shiftNo, cycle.vehicleId).services += 1;
    }
  }

  for (const slice of input.work) {
    const row = truckRow(slice.day, slice.vehicleId, slice.shiftNo);
    row.workSec += slice.workSec;
    row.movingSec += slice.movingSec;
    row.distanceM += slice.distanceM;
    if (slice.driverName && slice.workSec >= MIN_ACTIVE_SEC) row.drivers.add(slice.driverName);
    if (!slice.driverId || slice.workSec <= 0) continue;
    for (const acc of driverRows(slice.driverId, slice.driverName ?? slice.driverId, slice.day)) {
      acc.workSec += slice.workSec;
      acc.movingSec += slice.movingSec;
      acc.distanceM += slice.distanceM;
      const vehicle = acc.vehicles.get(slice.vehicleId) ?? { workSec: 0, services: 0 };
      vehicle.workSec += slice.workSec;
      acc.vehicles.set(slice.vehicleId, vehicle);
      if (slice.workSec >= MIN_ACTIVE_SEC) {
        acc.days.add(slice.day);
        acc.shifts.add(`${slice.day}#${slice.shiftNo}`);
      }
    }
  }

  const byName = (a: { driverName: string }, b: { driverName: string }) =>
    NATURAL.compare(a.driverName, b.driverName);
  const periodRows = (map: Map<string, DriverAcc>): DriverPeriodRow[] =>
    [...map.values()]
      .filter((acc) => acc.services > 0 || acc.workSec >= MIN_ACTIVE_SEC)
      .map((acc) => {
        const period = acc.period ?? { key: '', from: '', to: '' };
        return { ...finishDriver(acc), period: period.key, from: period.from, to: period.to };
      })
      .sort((a, b) => a.period.localeCompare(b.period) || byName(a, b));

  return {
    trucks: [...trucks.values()]
      .filter((row) => row.services > 0 || row.workSec > 0)
      .map(({ drivers, driverNames: _names, ...row }) => ({
        ...row,
        workSec: Math.round(row.workSec),
        movingSec: Math.round(row.movingSec),
        driverNames: [...drivers].sort(NATURAL.compare),
      }))
      .sort(
        (a, b) =>
          a.day.localeCompare(b.day) ||
          NATURAL.compare(a.vehicleId, b.vehicleId) ||
          a.shiftNo - b.shiftNo,
      ),
    drivers: [...totals.values()]
      .filter((acc) => acc.services > 0 || acc.workSec >= MIN_ACTIVE_SEC)
      .map(finishDriver)
      .sort(byName),
    driverDays: periodRows(days),
    driverMonths: periodRows(months),
  };
}
