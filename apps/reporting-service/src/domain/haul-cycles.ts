/**
 * Mine haul cycles. A service is one loaded trip: the truck enters the origin
 * (pit / shovel), leaves it, then enters the destination (dump). Shovels stay
 * in the origin; the shovel present while the truck is loading is credited.
 *
 * A work day is split into `shiftCount` back-to-back shifts of
 * `shiftDurationHours`, starting at `shiftStartHour` local time (two 12 h
 * shifts by default). The same truck is driven by a different driver in each
 * shift, so a per-shift roster wins over the vehicle's assignment history.
 */

const EARTH_RADIUS_M = 6_371_000;
/** A truck that steps outside the origin and back within this gap is still loading. */
const ORIGIN_JITTER_MS = 120_000;
const DAY_MS = 86_400_000;

export interface Zone {
  readonly kind: 'circle' | 'polygon';
  readonly lat?: number;
  readonly lng?: number;
  readonly radiusM?: number;
  /** [lng, lat] ring. Closed rings are accepted. */
  readonly ring?: ReadonlyArray<readonly [number, number]>;
}

export interface TrackSample {
  readonly at: Date;
  readonly lat: number;
  readonly lng: number;
}

export interface DriverInterval {
  readonly vehicleId: string;
  readonly driverId: string;
  readonly driverName: string;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}

export interface RosterDriver {
  readonly driverId: string;
  readonly driverName: string;
}

export interface ShiftSlot {
  /** `YYYY-MM-DD#n`, or `off-shift`. */
  readonly key: string;
  /** Local date of the work day the shift belongs to; null when off-shift. */
  readonly date: string | null;
  /** 1-based shift number within the work day; 0 when off-shift. */
  readonly no: number;
}

export type DriverSource = 'ROSTER' | 'ASSIGNMENT';

export interface HaulCycle {
  readonly vehicleId: string;
  readonly shovelId: string | null;
  readonly driverId: string | null;
  readonly driverName: string | null;
  readonly driverSource: DriverSource | null;
  readonly originEnteredAt: Date;
  readonly originLeftAt: Date;
  readonly destinationEnteredAt: Date;
  readonly loadDwellSec: number;
  readonly travelSec: number;
  readonly durationSec: number;
  readonly distanceM: number;
  readonly shift: string;
  readonly shiftDate: string | null;
  readonly shiftNo: number;
}

export interface OpenHaul {
  readonly vehicleId: string;
  readonly phase: 'LOADING' | 'HAULING';
  readonly since: Date;
}

export interface DetectHaulInput {
  readonly trucks: readonly string[];
  /** Ids used as track keys. The one inside the origin during loading is credited. */
  readonly shovels: readonly string[];
  readonly tracks: ReadonlyMap<string, readonly TrackSample[]>;
  readonly origin: Zone;
  readonly destination: Zone;
  readonly drivers: readonly DriverInterval[];
  /** Per truck: index `n - 1` is the driver of shift `n`. */
  readonly rosters?: ReadonlyMap<string, ReadonlyArray<RosterDriver | null>>;
  readonly shiftStartHour: number;
  readonly shiftDurationHours: number;
  readonly shiftCount?: number;
  readonly timeZone: string;
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lng2 - lng1);
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function zoneContains(lat: number, lng: number, zone: Zone): boolean {
  if (
    zone.kind === 'circle' &&
    typeof zone.lat === 'number' &&
    typeof zone.lng === 'number' &&
    typeof zone.radiusM === 'number'
  ) {
    return haversineMeters(lat, lng, zone.lat, zone.lng) <= zone.radiusM;
  }
  const ring = zone.ring;
  if (!ring || ring.length < 3) return false;
  return pointInRing(lng, lat, ring);
}

/** Shift label for the window that contains `at`, or `off-shift`. */
export function shiftKey(
  at: Date,
  startHour: number,
  durationHours: number,
  timeZone: string,
  shiftCount = 1,
): string {
  return shiftSlot(at, startHour, durationHours, timeZone, shiftCount).key;
}

/**
 * The shift that contains `at`. Shifts are back-to-back: shift 1 starts at
 * `startHour`, shift 2 at `startHour + durationHours`, and so on. A work day
 * that crosses midnight keeps the date it started on.
 */
export function shiftSlot(
  at: Date,
  startHour: number,
  durationHours: number,
  timeZone: string,
  shiftCount = 1,
): ShiftSlot {
  const start = clampHour(startHour);
  const duration = clampDuration(durationHours);
  const count = clampCount(shiftCount, duration);
  const parts = localParts(at, timeZone);
  const offset = (parts.hour - start + 24) % 24;
  const no = Math.floor(offset / duration) + 1;
  if (no > count) return { key: 'off-shift', date: null, no: 0 };
  const date =
    parts.hour < start ? localParts(new Date(at.getTime() - DAY_MS), timeZone).date : parts.date;
  return { key: `${date}#${no}`, date, no };
}

/** Largest shift count that still fits in 24 hours. */
export function maxShiftCount(durationHours: number): number {
  return Math.max(1, Math.floor(24 / clampDuration(durationHours)));
}

/**
 * Report window aligned to work days instead of UTC midnights, so `today`
 * holds every shift that started today and `yesterday` holds both shifts of
 * the previous work day, including the night shift after midnight.
 */
export function shiftDayWindow(
  preset: string,
  startHour: number,
  timeZone: string,
  now: Date,
): { from: Date; to: Date } | null {
  const start = clampHour(startHour);
  const parts = localParts(now, timeZone);
  const day =
    parts.hour < start ? localParts(new Date(now.getTime() - DAY_MS), timeZone).date : parts.date;
  const dayStart = zonedTime(day, start, timeZone);
  switch (preset) {
    case 'today':
      return { from: dayStart, to: now };
    case 'yesterday':
      return { from: new Date(dayStart.getTime() - DAY_MS), to: dayStart };
    case '7d':
      return { from: new Date(dayStart.getTime() - 6 * DAY_MS), to: now };
    case '30d':
      return { from: new Date(dayStart.getTime() - 29 * DAY_MS), to: now };
    default:
      return null;
  }
}

export function detectHaulCycles(input: DetectHaulInput): {
  cycles: HaulCycle[];
  open: OpenHaul[];
} {
  const cycles: HaulCycle[] = [];
  const open: OpenHaul[] = [];
  for (const vehicleId of input.trucks) {
    const samples = [...(input.tracks.get(vehicleId) ?? [])].sort(
      (a, b) => a.at.getTime() - b.at.getTime(),
    );
    let phase: 'OUT' | 'LOADING' | 'HAULING' = 'OUT';
    let enteredAt: Date | null = null;
    let leftAt: Date | null = null;
    let lastInOrigin: TrackSample | null = null;
    let leg: TrackSample[] = [];

    const reset = () => {
      phase = 'OUT';
      enteredAt = null;
      leftAt = null;
      lastInOrigin = null;
      leg = [];
    };

    const complete = (loadedAt: Date, departedAt: Date, arrival: TrackSample) => {
      cycles.push(buildCycle(input, vehicleId, loadedAt, departedAt, arrival.at, leg));
      reset();
    };

    for (const sample of samples) {
      const inOrigin = zoneContains(sample.lat, sample.lng, input.origin);
      const inDest = zoneContains(sample.lat, sample.lng, input.destination);
      if (phase === 'OUT') {
        if (inOrigin && !inDest) {
          phase = 'LOADING';
          enteredAt = sample.at;
          lastInOrigin = sample;
        }
        continue;
      }
      if (phase === 'LOADING') {
        if (inOrigin) {
          lastInOrigin = sample;
          continue;
        }
        if (inDest && enteredAt && lastInOrigin) {
          // Sparse fixes: the truck jumped from the origin straight into the
          // destination with no fix in between. Still one service.
          leftAt = lastInOrigin.at;
          leg = [lastInOrigin, sample];
          complete(enteredAt, leftAt, sample);
          continue;
        }
        phase = 'HAULING';
        leftAt = sample.at;
        leg = lastInOrigin ? [lastInOrigin, sample] : [sample];
        continue;
      }
      leg.push(sample);
      if (inOrigin && !inDest) {
        const jitter =
          leftAt !== null && sample.at.getTime() - leftAt.getTime() <= ORIGIN_JITTER_MS;
        phase = 'LOADING';
        // A short step outside the origin (GPS noise at the fence edge) does
        // not restart the loading clock.
        if (!jitter) enteredAt = sample.at;
        lastInOrigin = sample;
        leftAt = null;
        leg = [];
        continue;
      }
      if (inDest && enteredAt && leftAt) complete(enteredAt, leftAt, sample);
    }

    if (phase === 'LOADING' && enteredAt)
      open.push({ vehicleId, phase: 'LOADING', since: enteredAt });
    if (phase === 'HAULING' && leftAt) open.push({ vehicleId, phase: 'HAULING', since: leftAt });
  }
  cycles.sort((a, b) => a.originEnteredAt.getTime() - b.originEnteredAt.getTime());
  return { cycles, open };
}

function buildCycle(
  input: DetectHaulInput,
  vehicleId: string,
  enteredAt: Date,
  leftAt: Date,
  arrivedAt: Date,
  leg: readonly TrackSample[],
): HaulCycle {
  const slot = shiftSlot(
    enteredAt,
    input.shiftStartHour,
    input.shiftDurationHours,
    input.timeZone,
    input.shiftCount ?? 1,
  );
  const rostered = slot.no > 0 ? (input.rosters?.get(vehicleId)?.[slot.no - 1] ?? null) : null;
  const assigned = rostered ? null : driverAt(input.drivers, vehicleId, enteredAt);
  const driver = rostered ?? assigned;
  return {
    vehicleId,
    shovelId: shovelAt(input, enteredAt, leftAt),
    driverId: driver?.driverId ?? null,
    driverName: driver?.driverName ?? null,
    driverSource: rostered ? 'ROSTER' : assigned ? 'ASSIGNMENT' : null,
    originEnteredAt: enteredAt,
    originLeftAt: leftAt,
    destinationEnteredAt: arrivedAt,
    loadDwellSec: secondsBetween(enteredAt, leftAt),
    travelSec: secondsBetween(leftAt, arrivedAt),
    durationSec: secondsBetween(enteredAt, arrivedAt),
    distanceM: pathDistance(leg),
    shift: slot.key,
    shiftDate: slot.date,
    shiftNo: slot.no,
  };
}

export interface ShiftSummary {
  shift: string;
  shiftDate: string | null;
  shiftNo: number;
  services: number;
  distanceM: number;
  durationSec: number;
  loadDwellSec: number;
  trucks: number;
  drivers: number;
  /** Services with no driver from the roster or the assignment history. */
  withoutDriver: number;
}

export function summarizeHauls(cycles: readonly HaulCycle[]): {
  byVehicle: Array<{ vehicleId: string; services: number; distanceM: number; durationSec: number }>;
  byDriverShift: Array<{
    driverId: string;
    driverName: string;
    shift: string;
    shiftDate: string | null;
    shiftNo: number;
    vehicleIds: string[];
    services: number;
    distanceM: number;
    durationSec: number;
  }>;
  byShift: ShiftSummary[];
  byShovel: Array<{ shovelId: string; loads: number }>;
} {
  const vehicles = new Map<string, { services: number; distanceM: number; durationSec: number }>();
  const drivers = new Map<
    string,
    {
      driverId: string;
      driverName: string;
      shift: string;
      shiftDate: string | null;
      shiftNo: number;
      vehicles: Set<string>;
      services: number;
      distanceM: number;
      durationSec: number;
    }
  >();
  const shifts = new Map<
    string,
    Omit<ShiftSummary, 'trucks' | 'drivers'> & { trucks: Set<string>; drivers: Set<string> }
  >();
  const shovels = new Map<string, number>();
  for (const cycle of cycles) {
    const vehicle = vehicles.get(cycle.vehicleId) ?? { services: 0, distanceM: 0, durationSec: 0 };
    vehicle.services += 1;
    vehicle.distanceM += cycle.distanceM;
    vehicle.durationSec += cycle.durationSec;
    vehicles.set(cycle.vehicleId, vehicle);

    const shift = shifts.get(cycle.shift) ?? {
      shift: cycle.shift,
      shiftDate: cycle.shiftDate,
      shiftNo: cycle.shiftNo,
      services: 0,
      distanceM: 0,
      durationSec: 0,
      loadDwellSec: 0,
      trucks: new Set<string>(),
      drivers: new Set<string>(),
      withoutDriver: 0,
    };
    shift.services += 1;
    shift.distanceM += cycle.distanceM;
    shift.durationSec += cycle.durationSec;
    shift.loadDwellSec += cycle.loadDwellSec;
    shift.trucks.add(cycle.vehicleId);
    if (cycle.driverId) shift.drivers.add(cycle.driverId);
    else shift.withoutDriver += 1;
    shifts.set(cycle.shift, shift);

    if (cycle.driverId) {
      const key = `${cycle.driverId}|${cycle.shift}`;
      const row = drivers.get(key) ?? {
        driverId: cycle.driverId,
        driverName: cycle.driverName ?? cycle.driverId,
        shift: cycle.shift,
        shiftDate: cycle.shiftDate,
        shiftNo: cycle.shiftNo,
        vehicles: new Set<string>(),
        services: 0,
        distanceM: 0,
        durationSec: 0,
      };
      row.services += 1;
      row.distanceM += cycle.distanceM;
      row.durationSec += cycle.durationSec;
      row.vehicles.add(cycle.vehicleId);
      drivers.set(key, row);
    }
    if (cycle.shovelId) shovels.set(cycle.shovelId, (shovels.get(cycle.shovelId) ?? 0) + 1);
  }
  return {
    byVehicle: [...vehicles.entries()].map(([vehicleId, row]) => ({ vehicleId, ...row })),
    byDriverShift: [...drivers.values()]
      .sort((a, b) => compareShift(a, b) || a.driverName.localeCompare(b.driverName))
      .map(({ vehicles: ids, ...row }) => ({ ...row, vehicleIds: [...ids] })),
    byShift: [...shifts.values()].sort(compareShift).map((row) => ({
      ...row,
      trucks: row.trucks.size,
      drivers: row.drivers.size,
    })),
    byShovel: [...shovels.entries()].map(([shovelId, loads]) => ({ shovelId, loads })),
  };
}

/** Work day ascending, then shift number; off-shift rows go last. */
function compareShift(
  a: { shiftDate: string | null; shiftNo: number },
  b: { shiftDate: string | null; shiftNo: number },
): number {
  if (a.shiftDate === b.shiftDate) return a.shiftNo - b.shiftNo;
  if (a.shiftDate === null) return 1;
  if (b.shiftDate === null) return -1;
  return a.shiftDate < b.shiftDate ? -1 : 1;
}

function shovelAt(input: DetectHaulInput, enteredAt: Date, leftAt: Date): string | null {
  const from = enteredAt.getTime() - 120_000;
  const to = leftAt.getTime() + 120_000;
  let best: { id: string; score: number } | null = null;
  for (const shovelId of input.shovels) {
    const samples = input.tracks.get(shovelId) ?? [];
    let hits = 0;
    let nearest = Number.POSITIVE_INFINITY;
    for (const sample of samples) {
      const t = sample.at.getTime();
      if (t < from || t > to) continue;
      if (!zoneContains(sample.lat, sample.lng, input.origin)) continue;
      hits += 1;
      nearest = Math.min(nearest, Math.abs(t - enteredAt.getTime()));
    }
    if (hits === 0) continue;
    const score = hits * 1_000_000 - nearest;
    if (!best || score > best.score) best = { id: shovelId, score };
  }
  return best?.id ?? null;
}

function driverAt(
  drivers: readonly DriverInterval[],
  vehicleId: string,
  at: Date,
): DriverInterval | null {
  const t = at.getTime();
  for (const driver of drivers) {
    if (driver.vehicleId !== vehicleId) continue;
    if (driver.startedAt.getTime() > t) continue;
    if (driver.endedAt && driver.endedAt.getTime() < t) continue;
    return driver;
  }
  return null;
}

function pathDistance(samples: readonly TrackSample[]): number {
  let total = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1];
    const curr = samples[i];
    if (!prev || !curr) continue;
    const dt = Math.max((curr.at.getTime() - prev.at.getTime()) / 1000, 1);
    const meters = haversineMeters(prev.lat, prev.lng, curr.lat, curr.lng);
    const speedKmh = (meters / 1000 / dt) * 3600;
    if (meters < 1 || speedKmh > 100) continue;
    total += meters;
  }
  return total;
}

function secondsBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000));
}

function pointInRing(
  lng: number,
  lat: number,
  ring: ReadonlyArray<readonly [number, number]>,
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    const [xi, yi] = a;
    const [xj, yj] = b;
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function localParts(
  at: Date,
  timeZone: string,
): { date: string; hour: number; minute: number; second: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  }
  const hour = Number(bag.hour ?? '0') % 24;
  return {
    date: `${bag.year}-${bag.month}-${bag.day}`,
    hour,
    minute: Number(bag.minute ?? '0'),
    second: Number(bag.second ?? '0'),
  };
}

/** The instant when the wall clock in `timeZone` reads `date` at `hour`:00. */
function zonedTime(date: string, hour: number, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hour);
  const offset = (t: number) => {
    const p = localParts(new Date(t), timeZone);
    const [py, pm, pd] = p.date.split('-').map(Number);
    return Date.UTC(py ?? 1970, (pm ?? 1) - 1, pd ?? 1, p.hour, p.minute, p.second) - t;
  };
  const first = guess - offset(guess);
  return new Date(guess - offset(first));
}

function clampHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0;
  return Math.min(23, Math.max(0, Math.floor(hour)));
}

function clampDuration(hours: number): number {
  if (!Number.isFinite(hours)) return 12;
  return Math.min(24, Math.max(1, Math.floor(hours)));
}

function clampCount(count: number, duration: number): number {
  if (!Number.isFinite(count)) return 1;
  return Math.min(maxShiftCount(duration), Math.max(1, Math.floor(count)));
}
