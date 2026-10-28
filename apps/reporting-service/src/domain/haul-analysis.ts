/**
 * Haul analysis — where the time of a service goes, and who loses it.
 *
 * A service (see haul-cycles.ts) is split into four phases:
 *
 *   loading    origin entered → origin left          (queue + shovel loading)
 *   travel     origin left → destination entered     (loaded haul)
 *   unloading  destination entered → destination left
 *   return     destination left → next origin entry  (empty run back)
 *
 * Nothing in the position stream says what a "good" time is, so the loss of a
 * phase is measured against a reference: the time the fleet itself achieves a
 * quarter of the time (25th percentile), or a target the operator configures.
 * Time above the reference is waste. A route with fewer than four samples for
 * a phase uses the median instead, so a handful of services never produce a
 * large artificial loss.
 *
 * Stops on the road are reported as causes. They are already inside the travel
 * and return phases, so they are never added to the waste a second time.
 */
import {
  type DriverContext,
  type HaulCycle,
  type OpenHaul,
  type TrackSample,
  type Zone,
  resolveDriver,
  zoneContains,
} from './haul-cycles.js';
import {
  type BreakPolicy,
  type StopCategory,
  categoryOf,
  plannedOverlap,
} from './planned-stops.js';

/** At or below this speed a machine counts as standing. */
export const DEFAULT_STANDING_KMH = 3;
/** A gap between fixes longer than this is time we cannot see. */
export const DEFAULT_NO_DATA_GAP_SEC = 300;
/** A stop outside the origin / destination shorter than this is not reported. */
export const DEFAULT_MIN_STOP_SEC = 600;
/** A driver is flagged when a phase averages this much over the fleet median. */
export const DRIVER_SLOW_RATIO = 1.25;
/** Services a driver needs before the comparison is meaningful. */
export const MIN_DRIVER_SERVICES = 3;
const MAX_STOPS = 100;
/** Gaps between two loads of a shovel beyond this are breaks, not starvation. */
const SHOVEL_IDLE_CAP_SEC = 1800;

export type Phase = 'load' | 'travel' | 'unload' | 'return';
export const PHASES: readonly Phase[] = ['load', 'travel', 'unload', 'return'];

export interface CycleTiming {
  readonly cycle: HaulCycle;
  readonly destinationLeftAt: Date | null;
  /** Null when the truck was still inside the destination at the end of its track. */
  readonly unloadSec: number | null;
  /** Null for the last service of a truck: no later origin entry to measure to. */
  readonly returnSec: number | null;
  /** Origin entry → next origin entry. */
  readonly cycleSec: number | null;
}

export interface TimeBudget {
  /** Inside the origin, engine not switched off. */
  originSec: number;
  /** Inside the destination, engine not switched off. */
  destinationSec: number;
  /** Outside both zones and moving. */
  movingSec: number;
  /** Outside both zones, standing, engine not switched off. */
  idleOutsideSec: number;
  /** Standing with the engine switched off, anywhere. */
  parkedSec: number;
  /** Gaps between fixes longer than the no-data gap. */
  noDataSec: number;
  /** Standing inside the lunch window (not counted in the other standing buckets). */
  lunchSec: number;
  /** Standing with the engine off around a shift boundary (not counted in the others). */
  handoverSec: number;
}

export interface StopEvent {
  readonly vehicleId: string;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly durationSec: number;
  readonly lat: number;
  readonly lng: number;
  /** False when the engine was off for the whole stop. */
  readonly engineOn: boolean;
  /** Loaded = between leaving the origin and reaching the destination. */
  readonly phase: 'LOADED' | 'EMPTY';
  readonly driverId: string | null;
  readonly driverName: string | null;
  /** OPERATIONAL = a stop of the machine; LUNCH / HANDOVER are planned stops. */
  readonly category: StopCategory;
}

export interface TruckMeasure {
  readonly vehicleId: string;
  readonly timings: CycleTiming[];
  readonly budget: TimeBudget;
  readonly stops: StopEvent[];
}

export interface MeasureTruckInput extends DriverContext {
  readonly vehicleId: string;
  readonly samples: readonly TrackSample[];
  /** This truck's services, as detected on the same samples. */
  readonly cycles: readonly HaulCycle[];
  readonly origin: Zone;
  readonly destination: Zone;
  readonly standingKmh?: number;
  readonly noDataGapSec?: number;
  readonly minStopSec?: number;
  /** Lunch and shift-handover windows of the route; null leaves every stop operational. */
  readonly breaks?: BreakPolicy | null;
}

export function emptyBudget(): TimeBudget {
  return {
    originSec: 0,
    destinationSec: 0,
    movingSec: 0,
    idleOutsideSec: 0,
    parkedSec: 0,
    noDataSec: 0,
    lunchSec: 0,
    handoverSec: 0,
  };
}

export function addBudget(into: TimeBudget, add: TimeBudget): void {
  into.originSec += add.originSec;
  into.destinationSec += add.destinationSec;
  into.movingSec += add.movingSec;
  into.idleOutsideSec += add.idleOutsideSec;
  into.parkedSec += add.parkedSec;
  into.noDataSec += add.noDataSec;
  into.lunchSec += add.lunchSec;
  into.handoverSec += add.handoverSec;
}

/** Everything one truck's own track says: unload / return times, where its time went, its stops. */
export function measureTruck(input: MeasureTruckInput): TruckMeasure {
  const samples = [...input.samples].sort((a, b) => a.at.getTime() - b.at.getTime());
  const standingKmh = input.standingKmh ?? DEFAULT_STANDING_KMH;
  const noDataGapSec = input.noDataGapSec ?? DEFAULT_NO_DATA_GAP_SEC;
  const minStopSec = input.minStopSec ?? DEFAULT_MIN_STOP_SEC;
  const cycles = [...input.cycles].sort(
    (a, b) => a.originEnteredAt.getTime() - b.originEnteredAt.getTime(),
  );
  const inOrigin = samples.map((s) => zoneContains(s.lat, s.lng, input.origin));
  const inDest = samples.map((s) => zoneContains(s.lat, s.lng, input.destination));

  const timings = cycles.map((cycle, index) =>
    timingOf(cycle, cycles[index + 1] ?? null, samples, inDest),
  );

  const budget = emptyBudget();
  const stops: StopEvent[] = [];
  let stop: {
    start: TrackSample;
    end: Date;
    sec: number;
    engineOn: boolean;
    lunchSec: number;
    handoverSec: number;
  } | null = null;
  const flush = () => {
    if (stop && stop.sec >= minStopSec) {
      const { driver } = resolveDriver(input, input.vehicleId, stop.start.at);
      stops.push({
        vehicleId: input.vehicleId,
        startedAt: stop.start.at,
        endedAt: stop.end,
        durationSec: Math.round(stop.sec),
        lat: stop.start.lat,
        lng: stop.start.lng,
        engineOn: stop.engineOn,
        phase: isLoadedLeg(cycles, stop.start.at) ? 'LOADED' : 'EMPTY',
        driverId: driver?.driverId ?? null,
        driverName: driver?.driverName ?? null,
        category: categoryOf({ lunchSec: stop.lunchSec, handoverSec: stop.handoverSec }, stop.sec),
      });
    }
    stop = null;
  };

  for (let i = 0; i + 1 < samples.length; i += 1) {
    const a = samples[i];
    const b = samples[i + 1];
    if (!a || !b) continue;
    const dt = (b.at.getTime() - a.at.getTime()) / 1000;
    if (dt <= 0) continue;
    if (dt > noDataGapSec) {
      budget.noDataSec += dt;
      flush();
      continue;
    }
    const standing = isStanding(a, b, dt, standingKmh);
    const engineOff = a.ignitionOn === false;
    const zone = inOrigin[i] ? 'origin' : inDest[i] ? 'destination' : null;
    // Lunch and handover are carved out of the standing time first.
    const planned = standing
      ? plannedOverlap(a.at, b.at, engineOff, input.breaks ?? null)
      : { lunchSec: 0, handoverSec: 0 };
    const plannedSec = Math.min(dt, planned.lunchSec + planned.handoverSec);
    budget.lunchSec += planned.lunchSec;
    budget.handoverSec += planned.handoverSec;
    const rest = dt - plannedSec;
    if (standing && engineOff) {
      budget.parkedSec += rest;
    } else if (zone === 'origin') {
      budget.originSec += rest;
    } else if (zone === 'destination') {
      budget.destinationSec += rest;
    } else if (!standing) {
      budget.movingSec += rest;
    } else {
      budget.idleOutsideSec += rest;
    }

    if (standing && zone === null) {
      stop ??= { start: a, end: b.at, sec: 0, engineOn: false, lunchSec: 0, handoverSec: 0 };
      stop.sec += dt;
      stop.end = b.at;
      stop.lunchSec += planned.lunchSec;
      stop.handoverSec += planned.handoverSec;
      if (!engineOff) stop.engineOn = true;
    } else {
      flush();
    }
  }
  flush();
  return { vehicleId: input.vehicleId, timings, budget, stops };
}

function timingOf(
  cycle: HaulCycle,
  next: HaulCycle | null,
  samples: readonly TrackSample[],
  inDest: readonly boolean[],
): CycleTiming {
  const arrived = cycle.destinationEnteredAt.getTime();
  const nextEntry = next ? next.originEnteredAt.getTime() : Number.POSITIVE_INFINITY;
  // The first fix outside the destination after arriving is when the truck
  // left it, the same convention the origin uses for "left at". A track that
  // ends (or turns to the next service) before that leaves the unload open.
  let left: Date | null = null;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    if (!sample) continue;
    const t = sample.at.getTime();
    if (t < arrived) continue;
    if (t >= nextEntry) break;
    if (!inDest[i]) {
      left = sample.at;
      break;
    }
  }
  const unloadSec = left ? secondsBetween(cycle.destinationEnteredAt, left) : null;
  const returnSec = left && next ? secondsBetween(left, next.originEnteredAt) : null;
  const cycleSec = next ? secondsBetween(cycle.originEnteredAt, next.originEnteredAt) : null;
  return { cycle, destinationLeftAt: left, unloadSec, returnSec, cycleSec };
}

function isLoadedLeg(cycles: readonly HaulCycle[], at: Date): boolean {
  const t = at.getTime();
  return cycles.some((c) => t >= c.originLeftAt.getTime() && t <= c.destinationEnteredAt.getTime());
}

function isStanding(a: TrackSample, b: TrackSample, dt: number, standingKmh: number): boolean {
  if (typeof a.speedKmh === 'number') return a.speedKmh <= standingKmh;
  // No speed on the fix: fall back on how far the next fix is.
  const dLat = (b.lat - a.lat) * 111_320;
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  const meters = Math.hypot(dLat, dLng);
  return (meters / dt) * 3.6 <= standingKmh;
}

function secondsBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000));
}

// ---------------------------------------------------------------------------
// Fleet-level analysis
// ---------------------------------------------------------------------------

export interface PhaseTargets {
  readonly loadSec?: number;
  readonly travelSec?: number;
  readonly unloadSec?: number;
  readonly returnSec?: number;
}

export interface PhaseReference {
  readonly samples: number;
  /** The time a phase should take; everything above is waste. */
  readonly referenceSec: number | null;
  readonly medianSec: number | null;
  /** Slower than three quarters of all services: a sensible alert limit. */
  readonly p75Sec: number | null;
  readonly maxSec: number | null;
  readonly source: 'CONFIGURED' | 'FLEET' | 'NONE';
}

export interface CycleWaste {
  readonly timing: CycleTiming;
  readonly loadSec: number;
  readonly travelSec: number;
  readonly unloadSec: number;
  readonly returnSec: number;
  readonly totalSec: number;
}

export interface WasteTotals {
  loadSec: number;
  travelSec: number;
  unloadSec: number;
  returnSec: number;
  totalSec: number;
}

export interface DriverScore {
  readonly driverId: string;
  readonly driverName: string;
  readonly vehicleIds: string[];
  readonly services: number;
  readonly avgLoadSec: number | null;
  readonly avgTravelSec: number | null;
  readonly avgUnloadSec: number | null;
  readonly avgReturnSec: number | null;
  readonly waste: WasteTotals;
  readonly wastePerServiceSec: number;
  readonly stopCount: number;
  readonly stopSec: number;
}

export interface VehicleScore {
  readonly vehicleId: string;
  readonly services: number;
  readonly avgCycleSec: number | null;
  readonly avgLoadSec: number | null;
  readonly avgUnloadSec: number | null;
  readonly waste: WasteTotals;
  readonly budget: TimeBudget;
  readonly stopCount: number;
}

export interface ShiftScore {
  readonly shift: string;
  readonly shiftDate: string | null;
  readonly shiftNo: number;
  readonly services: number;
  readonly trucks: number;
  readonly avgCycleSec: number | null;
  readonly waste: WasteTotals;
}

export interface ShovelScore {
  readonly shovelId: string;
  readonly loads: number;
  readonly avgLoadSec: number | null;
  /** Trucks waiting while the shovel served another one. */
  readonly truckQueueSec: number;
  /** The shovel waiting for the next truck (breaks over 30 min excluded). */
  readonly shovelIdleSec: number;
}

export type FindingCode =
  | 'DRIVER_SLOW_LOAD'
  | 'DRIVER_SLOW_UNLOAD'
  | 'DRIVER_LONG_STOPS'
  | 'SHOVEL_QUEUE'
  | 'SHOVEL_STARVED'
  | 'NO_DRIVER'
  | 'LOW_DATA'
  | 'LOAD_IS_BIGGEST';

export interface Finding {
  readonly code: FindingCode;
  /** Driver, shovel or truck the finding is about; null for fleet-wide ones. */
  readonly subject: string | null;
  readonly subjectId: string | null;
  /** Measured value and the value it is compared with, in the finding's own unit. */
  readonly value: number;
  readonly reference: number | null;
}

export interface OpenHaulStatus extends OpenHaul {
  readonly elapsedSec: number;
  /** Past the p75 of its phase: the truck is slower than three quarters of services. */
  readonly overdue: boolean;
}

export interface HaulAnalysis {
  readonly services: number;
  readonly references: Record<Phase, PhaseReference>;
  readonly cycleMedianSec: number | null;
  readonly waste: WasteTotals;
  /** Waste as a share of all measured phase time (0–1). */
  readonly wasteShare: number | null;
  /** Waste expressed in services the fleet could have made with it. */
  readonly lostServices: number | null;
  readonly budget: TimeBudget;
  readonly cycles: CycleWaste[];
  readonly byVehicle: VehicleScore[];
  readonly byDriver: DriverScore[];
  readonly byShift: ShiftScore[];
  readonly byShovel: ShovelScore[];
  /** Every reported stop, longest first; `category` tells the machine's own from the planned ones. */
  readonly stops: StopEvent[];
  /** Stops of the machine itself (lunch and handover are counted apart). */
  readonly stopCount: number;
  readonly stopSec: number;
  /** Planned stops: lunch and shift handover. */
  readonly plannedStops: PlannedStops;
  readonly openHauls: OpenHaulStatus[];
  readonly withoutDriver: number;
  readonly findings: Finding[];
}

export interface PlannedStops {
  readonly lunchCount: number;
  readonly lunchSec: number;
  readonly handoverCount: number;
  readonly handoverSec: number;
}

export interface AnalyzeHaulInput {
  readonly measures: readonly TruckMeasure[];
  readonly open: readonly OpenHaul[];
  readonly now: Date;
  readonly targets?: PhaseTargets;
}

export function analyzeHaul(input: AnalyzeHaulInput): HaulAnalysis {
  const timings = input.measures.flatMap((m) => m.timings);
  timings.sort((a, b) => a.cycle.originEnteredAt.getTime() - b.cycle.originEnteredAt.getTime());
  const allStops = input.measures
    .flatMap((m) => m.stops)
    .sort((a, b) => b.durationSec - a.durationSec);
  // Lunch and shift handover are not the machine's own stops: they stay out of
  // the stop totals and out of the driver scores.
  const stops = allStops.filter((s) => s.category === 'OPERATIONAL');
  const lunch = allStops.filter((s) => s.category === 'LUNCH');
  const handover = allStops.filter((s) => s.category === 'HANDOVER');
  const sumSec = (list: readonly StopEvent[]) => list.reduce((sum, s) => sum + s.durationSec, 0);

  const values = (phase: Phase) =>
    timings
      .map((t) => phaseValue(t, phase))
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
  const references = {
    load: reference(values('load'), input.targets?.loadSec),
    travel: reference(values('travel'), input.targets?.travelSec),
    unload: reference(values('unload'), input.targets?.unloadSec),
    return: reference(values('return'), input.targets?.returnSec),
  } satisfies Record<Phase, PhaseReference>;

  const cycles: CycleWaste[] = timings.map((timing) => wasteOf(timing, references));
  const waste = sumWaste(cycles);

  let measured = 0;
  for (const timing of timings) {
    for (const phase of PHASES) measured += phaseValue(timing, phase) ?? 0;
  }
  const cycleMedian = percentile(
    timings.map((t) => t.cycleSec).filter((v): v is number => v !== null),
    0.5,
  );

  const budget = emptyBudget();
  for (const m of input.measures) addBudget(budget, m.budget);

  const byVehicle = vehicleScores(input.measures, cycles);
  const byDriver = driverScores(cycles, stops);
  const byShift = shiftScores(cycles);
  const byShovel = shovelScores(timings);
  const openHauls = input.open.map((row) => {
    const elapsedSec = secondsBetween(row.since, input.now);
    const limit = row.phase === 'LOADING' ? references.load.p75Sec : references.travel.p75Sec;
    return { ...row, elapsedSec, overdue: limit !== null && elapsedSec > limit };
  });
  const withoutDriver = timings.filter((t) => !t.cycle.driverId).length;
  const stopSec = sumSec(stops);

  return {
    services: timings.length,
    references,
    cycleMedianSec: cycleMedian,
    waste,
    wasteShare: measured > 0 ? waste.totalSec / measured : null,
    lostServices: cycleMedian && cycleMedian > 0 ? waste.totalSec / cycleMedian : null,
    budget,
    cycles,
    byVehicle,
    byDriver,
    byShift,
    byShovel,
    stops: allStops.slice(0, MAX_STOPS),
    stopCount: stops.length,
    stopSec,
    plannedStops: {
      lunchCount: lunch.length,
      lunchSec: sumSec(lunch),
      handoverCount: handover.length,
      handoverSec: sumSec(handover),
    },
    openHauls,
    withoutDriver,
    findings: findingsOf({
      references,
      waste,
      byDriver,
      byShovel,
      budget,
      withoutDriver,
      services: timings.length,
    }),
  };
}

function phaseValue(t: CycleTiming, phase: Phase): number | null {
  switch (phase) {
    case 'load':
      return t.cycle.loadDwellSec;
    case 'travel':
      return t.cycle.travelSec;
    case 'unload':
      return t.unloadSec;
    case 'return':
      return t.returnSec;
  }
}

function reference(sorted: readonly number[], configured: number | undefined): PhaseReference {
  const median = percentile(sorted, 0.5);
  const base = {
    samples: sorted.length,
    medianSec: median,
    p75Sec: percentile(sorted, 0.75),
    maxSec: sorted.length > 0 ? (sorted[sorted.length - 1] ?? null) : null,
  };
  if (configured !== undefined && configured > 0) {
    return { ...base, referenceSec: Math.round(configured), source: 'CONFIGURED' };
  }
  if (sorted.length === 0) return { ...base, referenceSec: null, source: 'NONE' };
  const best = sorted.length >= 4 ? percentile(sorted, 0.25) : median;
  return { ...base, referenceSec: best === null ? null : Math.round(best), source: 'FLEET' };
}

/** Linear-interpolated percentile of an ascending list; null when empty. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (pos - lo);
}

function excess(value: number | null, ref: PhaseReference): number {
  if (value === null || ref.referenceSec === null) return 0;
  return Math.max(0, value - ref.referenceSec);
}

function wasteOf(timing: CycleTiming, refs: Record<Phase, PhaseReference>): CycleWaste {
  const loadSec = excess(phaseValue(timing, 'load'), refs.load);
  const travelSec = excess(phaseValue(timing, 'travel'), refs.travel);
  const unloadSec = excess(phaseValue(timing, 'unload'), refs.unload);
  const returnSec = excess(phaseValue(timing, 'return'), refs.return);
  return {
    timing,
    loadSec,
    travelSec,
    unloadSec,
    returnSec,
    totalSec: loadSec + travelSec + unloadSec + returnSec,
  };
}

function emptyWaste(): WasteTotals {
  return { loadSec: 0, travelSec: 0, unloadSec: 0, returnSec: 0, totalSec: 0 };
}

function addWaste(into: WasteTotals, row: CycleWaste): void {
  into.loadSec += row.loadSec;
  into.travelSec += row.travelSec;
  into.unloadSec += row.unloadSec;
  into.returnSec += row.returnSec;
  into.totalSec += row.totalSec;
}

function sumWaste(rows: readonly CycleWaste[]): WasteTotals {
  const total = emptyWaste();
  for (const row of rows) addWaste(total, row);
  return total;
}

function mean(values: readonly (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return null;
  return Math.round(known.reduce((sum, v) => sum + v, 0) / known.length);
}

function vehicleScores(
  measures: readonly TruckMeasure[],
  cycles: readonly CycleWaste[],
): VehicleScore[] {
  const byVehicle = new Map<string, CycleWaste[]>();
  for (const row of cycles) {
    const list = byVehicle.get(row.timing.cycle.vehicleId) ?? [];
    list.push(row);
    byVehicle.set(row.timing.cycle.vehicleId, list);
  }
  const scores: VehicleScore[] = [];
  for (const m of measures) {
    const rows = byVehicle.get(m.vehicleId) ?? [];
    scores.push({
      vehicleId: m.vehicleId,
      services: rows.length,
      avgCycleSec: mean(rows.map((r) => r.timing.cycleSec)),
      avgLoadSec: mean(rows.map((r) => r.timing.cycle.loadDwellSec)),
      avgUnloadSec: mean(rows.map((r) => r.timing.unloadSec)),
      waste: sumWaste(rows),
      budget: m.budget,
      stopCount: m.stops.filter((s) => s.category === 'OPERATIONAL').length,
    });
  }
  return scores.sort((a, b) => b.waste.totalSec - a.waste.totalSec);
}

function driverScores(cycles: readonly CycleWaste[], stops: readonly StopEvent[]): DriverScore[] {
  const groups = new Map<string, { name: string; rows: CycleWaste[]; stops: StopEvent[] }>();
  for (const row of cycles) {
    const { driverId, driverName } = row.timing.cycle;
    if (!driverId) continue;
    const group = groups.get(driverId) ?? {
      name: driverName ?? driverId,
      rows: [],
      stops: [],
    };
    group.rows.push(row);
    groups.set(driverId, group);
  }
  for (const stop of stops) {
    if (!stop.driverId) continue;
    const group = groups.get(stop.driverId);
    if (group) group.stops.push(stop);
  }
  return [...groups.entries()]
    .map(([driverId, group]) => {
      const waste = sumWaste(group.rows);
      return {
        driverId,
        driverName: group.name,
        vehicleIds: [...new Set(group.rows.map((r) => r.timing.cycle.vehicleId))],
        services: group.rows.length,
        avgLoadSec: mean(group.rows.map((r) => r.timing.cycle.loadDwellSec)),
        avgTravelSec: mean(group.rows.map((r) => r.timing.cycle.travelSec)),
        avgUnloadSec: mean(group.rows.map((r) => r.timing.unloadSec)),
        avgReturnSec: mean(group.rows.map((r) => r.timing.returnSec)),
        waste,
        wastePerServiceSec: Math.round(waste.totalSec / group.rows.length),
        stopCount: group.stops.length,
        stopSec: group.stops.reduce((sum, s) => sum + s.durationSec, 0),
      };
    })
    .sort((a, b) => b.wastePerServiceSec - a.wastePerServiceSec);
}

function shiftScores(cycles: readonly CycleWaste[]): ShiftScore[] {
  const groups = new Map<string, CycleWaste[]>();
  for (const row of cycles) {
    const list = groups.get(row.timing.cycle.shift) ?? [];
    list.push(row);
    groups.set(row.timing.cycle.shift, list);
  }
  return [...groups.entries()]
    .map(([shift, rows]) => {
      const first = rows[0]?.timing.cycle;
      return {
        shift,
        shiftDate: first?.shiftDate ?? null,
        shiftNo: first?.shiftNo ?? 0,
        services: rows.length,
        trucks: new Set(rows.map((r) => r.timing.cycle.vehicleId)).size,
        avgCycleSec: mean(rows.map((r) => r.timing.cycleSec)),
        waste: sumWaste(rows),
      };
    })
    .sort((a, b) => {
      if (a.shiftDate === b.shiftDate) return a.shiftNo - b.shiftNo;
      if (a.shiftDate === null) return 1;
      if (b.shiftDate === null) return -1;
      return a.shiftDate < b.shiftDate ? -1 : 1;
    });
}

/**
 * A shovel's loads in order: a truck that arrives while the previous one is
 * still loading queues for the overlap; a truck that arrives after it left
 * leaves the shovel idle for the gap.
 */
function shovelScores(timings: readonly CycleTiming[]): ShovelScore[] {
  const byShovel = new Map<string, HaulCycle[]>();
  for (const { cycle } of timings) {
    if (!cycle.shovelId) continue;
    const list = byShovel.get(cycle.shovelId) ?? [];
    list.push(cycle);
    byShovel.set(cycle.shovelId, list);
  }
  return [...byShovel.entries()]
    .map(([shovelId, loads]) => {
      loads.sort((a, b) => a.originEnteredAt.getTime() - b.originEnteredAt.getTime());
      let queue = 0;
      let idle = 0;
      for (let i = 1; i < loads.length; i += 1) {
        const prev = loads[i - 1];
        const next = loads[i];
        if (!prev || !next) continue;
        const overlap = prev.originLeftAt.getTime() - next.originEnteredAt.getTime();
        if (overlap > 0) {
          queue += Math.min(overlap, next.loadDwellSec * 1000) / 1000;
        } else {
          const gap = -overlap / 1000;
          if (gap <= SHOVEL_IDLE_CAP_SEC) idle += gap;
        }
      }
      return {
        shovelId,
        loads: loads.length,
        avgLoadSec: mean(loads.map((l) => l.loadDwellSec)),
        truckQueueSec: Math.round(queue),
        shovelIdleSec: Math.round(idle),
      };
    })
    .sort((a, b) => b.loads - a.loads);
}

interface FindingInput {
  references: Record<Phase, PhaseReference>;
  waste: WasteTotals;
  byDriver: readonly DriverScore[];
  byShovel: readonly ShovelScore[];
  budget: TimeBudget;
  withoutDriver: number;
  services: number;
}

/** Rule-based findings the dashboard words; only facts that act on a decision. */
function findingsOf(input: FindingInput): Finding[] {
  const out: Finding[] = [];
  const { references, waste } = input;

  for (const driver of input.byDriver) {
    if (driver.services < MIN_DRIVER_SERVICES) continue;
    const medLoad = references.load.medianSec;
    if (
      driver.avgLoadSec !== null &&
      medLoad !== null &&
      medLoad > 0 &&
      driver.avgLoadSec >= medLoad * DRIVER_SLOW_RATIO
    ) {
      out.push({
        code: 'DRIVER_SLOW_LOAD',
        subject: driver.driverName,
        subjectId: driver.driverId,
        value: driver.avgLoadSec,
        reference: medLoad,
      });
    }
    const medUnload = references.unload.medianSec;
    if (
      driver.avgUnloadSec !== null &&
      medUnload !== null &&
      medUnload > 0 &&
      driver.avgUnloadSec >= medUnload * DRIVER_SLOW_RATIO
    ) {
      out.push({
        code: 'DRIVER_SLOW_UNLOAD',
        subject: driver.driverName,
        subjectId: driver.driverId,
        value: driver.avgUnloadSec,
        reference: medUnload,
      });
    }
    if (driver.stopCount >= 2) {
      out.push({
        code: 'DRIVER_LONG_STOPS',
        subject: driver.driverName,
        subjectId: driver.driverId,
        value: driver.stopSec,
        reference: driver.stopCount,
      });
    }
  }

  for (const shovel of input.byShovel) {
    if (shovel.loads < MIN_DRIVER_SERVICES) continue;
    const busy = shovel.avgLoadSec !== null ? shovel.avgLoadSec * shovel.loads : 0;
    if (busy > 0 && shovel.truckQueueSec >= busy * 0.2) {
      out.push({
        code: 'SHOVEL_QUEUE',
        subject: null,
        subjectId: shovel.shovelId,
        value: shovel.truckQueueSec,
        reference: busy,
      });
    }
    if (busy > 0 && shovel.shovelIdleSec >= busy * 0.2) {
      out.push({
        code: 'SHOVEL_STARVED',
        subject: null,
        subjectId: shovel.shovelId,
        value: shovel.shovelIdleSec,
        reference: busy,
      });
    }
  }

  if (waste.totalSec > 0) {
    const biggest = (['loadSec', 'unloadSec', 'travelSec', 'returnSec'] as const).reduce(
      (best, key) => (waste[key] > waste[best] ? key : best),
      'loadSec' as 'loadSec' | 'unloadSec' | 'travelSec' | 'returnSec',
    );
    if (biggest === 'loadSec' && waste.loadSec >= waste.totalSec * 0.4) {
      out.push({
        code: 'LOAD_IS_BIGGEST',
        subject: null,
        subjectId: null,
        value: waste.loadSec,
        reference: waste.totalSec,
      });
    }
  }

  if (input.withoutDriver > 0) {
    out.push({
      code: 'NO_DRIVER',
      subject: null,
      subjectId: null,
      value: input.withoutDriver,
      reference: input.services,
    });
  }
  const b = input.budget;
  const total =
    b.originSec + b.destinationSec + b.movingSec + b.idleOutsideSec + b.parkedSec + b.noDataSec;
  if (total > 0 && b.noDataSec / total > 0.1) {
    out.push({
      code: 'LOW_DATA',
      subject: null,
      subjectId: null,
      value: b.noDataSec,
      reference: total,
    });
  }
  return out;
}
