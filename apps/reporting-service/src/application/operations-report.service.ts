/**
 * Mine operations reports.
 *
 * Device activity is the start-of-work record: the first stored fix after the
 * device belongs to this tenant, how many fixes arrived in the window, how
 * long the track was silent, and the filtered distance. Haul cycles are
 * computed on read from the same positions — a service is origin, leave,
 * destination. Haul presets are aligned to the route's work day (first shift
 * start, local time), so a night shift that runs past midnight is not split.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import {
  DEFAULT_MIN_STOP_SEC,
  type PhaseTargets,
  type TruckMeasure,
  analyzeHaul,
  measureTruck,
} from '../domain/haul-analysis.js';
import {
  type DriverInterval,
  type HaulCycle,
  type OpenHaul,
  type RosterDriver,
  type TrackSample,
  type Zone,
  detectHaulCycles,
  localDate,
  maxShiftCount,
  shiftDayWindow,
  summarizeHauls,
} from '../domain/haul-cycles.js';
import {
  PERIOD_CALENDARS,
  PERIOD_GRANULARITIES,
  periodsBetween,
  summarizePeriods,
} from '../domain/haul-periods.js';
import { policyOfRoute } from '../domain/planned-stops.js';
import {
  type ReportWindow,
  parseReportWindow,
  reportWindowErrorMessage,
} from '../domain/report-window.js';
import { ReportInputError, type ReportQueryBase } from './report.service.js';

/**
 * Positions are read one machine at a time, so the cap guards a single track
 * (about 90 days at one fix a minute, a month at one every ten seconds) and
 * not the whole fleet: a longer range or a bigger fleet only costs more
 * queries, never a silently incomplete count.
 */
const TRACK_POSITION_CAP = 250_000;
const TIME_ZONE = 'Asia/Tehran';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ActivityRow {
  device_id: string;
  imei: string;
  protocol: string;
  status: string;
  vehicle_id: string | null;
  vehicle_name: string | null;
  vehicle_code: string | null;
  plate: string | null;
  day: string | null;
  first_fix: Date | string | null;
  fixes: number | string;
  last_fix: Date | string | null;
  distance_m: number | string;
  offline_sec: number | string | null;
}

interface MemberRow {
  device_id: string;
  role: 'TRUCK' | 'SHOVEL';
  imei: string | null;
  vehicle_id: string | null;
  vehicle_name: string | null;
  shift_drivers: Array<string | null> | string | null;
}

interface RouteRow {
  id: string;
  name: string;
  origin_geofence_id: string;
  destination_geofence_id: string;
  shift_start_hour: number;
  shift_start_minute: number | null;
  shift_duration_hours: number;
  shift_duration_minutes: number | null;
  shift_count: number;
  lunch_start_minute: number | null;
  lunch_end_minute: number | null;
  handover_window_minutes: number | null;
}

/** Start of shift 1 as fractional local hours (06:30 → 6.5). */
function routeStartHour(route: RouteRow): number {
  return route.shift_start_hour + (route.shift_start_minute ?? 0) / 60;
}

/** Shift length as fractional hours (8 h 15 min → 8.25). */
function routeDurationHours(route: RouteRow): number {
  return route.shift_duration_hours + (route.shift_duration_minutes ?? 0) / 60;
}

interface GeofenceRow {
  id: string;
  geofence_type: string;
  lat: number | string | null;
  lng: number | string | null;
  radius_m: number | string | null;
  boundary: string | { coordinates?: number[][][] } | null;
}

interface PointRow {
  vehicle_id: string;
  captured_at: Date | string;
  latitude: number | string;
  longitude: number | string;
  speed_kmh: number | string | null;
  ignition_on: boolean | null;
}

/** Operator-set targets (minutes) for the analysis; blank means "use the fleet's own best". */
export interface HaulAnalysisInput extends ReportQueryBase {
  targetLoadMin?: string;
  targetTravelMin?: string;
  targetUnloadMin?: string;
  targetReturnMin?: string;
  stopMin?: string;
}

interface DriverRow {
  vehicle_id: string;
  driver_id: string;
  driver_name: string;
  started_at: Date | string;
  ended_at: Date | string | null;
  shift_no: number | null;
}

interface ZoneBounds {
  readonly minLat: number;
  readonly maxLat: number;
  readonly minLng: number;
  readonly maxLng: number;
}

/** Bounding box of a zone with a small margin, for pre-filtering positions in SQL. */
export function zoneBounds(zone: Zone): ZoneBounds {
  const margin = 0.001;
  if (zone.kind === 'circle' && zone.lat !== undefined && zone.lng !== undefined) {
    const dLat = (zone.radiusM ?? 0) / 111_320;
    const dLng = dLat / Math.max(0.01, Math.cos((zone.lat * Math.PI) / 180));
    return {
      minLat: zone.lat - dLat - margin,
      maxLat: zone.lat + dLat + margin,
      minLng: zone.lng - dLng - margin,
      maxLng: zone.lng + dLng + margin,
    };
  }
  const ring = zone.ring ?? [];
  const lngs = ring.map((pair) => pair[0]);
  const lats = ring.map((pair) => pair[1]);
  return {
    minLat: Math.min(...lats) - margin,
    maxLat: Math.max(...lats) + margin,
    minLng: Math.min(...lngs) - margin,
    maxLng: Math.max(...lngs) + margin,
  };
}

interface HaulComputation {
  readonly route: RouteRow;
  readonly shiftCount: number;
  readonly window: ReportWindow;
  readonly detected: ReturnType<typeof detectHaulCycles>;
  /** One per truck; filled only when the caller asked for the analysis. */
  readonly measures: TruckMeasure[];
  readonly truncated: boolean;
  readonly vehicleName: ReadonlyMap<string, string>;
  readonly shovelLabel: ReadonlyMap<string, string>;
  readonly unbound: Array<{ deviceId: string; imei: string | null; role: 'TRUCK' | 'SHOVEL' }>;
}

/** Minutes from a query string → seconds; blank = unset, anything else must be a positive number. */
function minutesToSec(value: string | undefined, field: string): number | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) {
    throw new ReportInputError(
      `${field} must be a number of minutes between 0 and 1440`,
      'INVALID_FILTER',
    );
  }
  return Math.round(minutes * 60);
}

function parseOption<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  const v = value?.trim();
  if (!v) return fallback;
  if ((allowed as readonly string[]).includes(v)) return v as T;
  throw new ReportInputError(`must be one of ${allowed.join('|')}`, 'INVALID_FILTER');
}

export class OperationsReportService {
  constructor(
    private readonly knex: Knex,
    private readonly queryTimeoutMs: number,
  ) {}

  public async deviceActivity(tenantId: string, input: ReportQueryBase) {
    const window = this.window(input);
    const { rows } = await this.query<{ rows: ActivityRow[] }>((trx) =>
      trx.raw(ACTIVITY_SQL, [
        tenantId,
        tenantId,
        window.from,
        window.to,
        tenantId,
        window.to,
        window.from,
        window.to,
        window.to,
        window.to,
      ]),
    );
    const vehicleIds = [...new Set(rows.map((row) => row.vehicle_id).filter(isString))];
    const drivers = await this.loadDrivers(tenantId, vehicleIds, window);
    const devices = rows.map((row) => toActivity(row, drivers)).sort(byMachineThenDay);
    const counted = new Set<string>();
    let totalDistanceM = 0;
    for (const row of rows) {
      if (!row.vehicle_id || !row.day) continue;
      const key = `${row.vehicle_id}|${row.day}`;
      if (counted.has(key)) continue;
      counted.add(key);
      totalDistanceM += num(row.distance_m);
    }
    const reporting = new Set(devices.filter((row) => row.fixes > 0).map((row) => row.deviceId));
    const allDevices = new Set(devices.map((row) => row.deviceId));
    return {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      totalDistanceKm: km(totalDistanceM),
      silentCount: allDevices.size - reporting.size,
      reportingCount: reporting.size,
      devices,
    };
  }

  public async haulCycles(tenantId: string, routeId: string | undefined, input: ReportQueryBase) {
    const haul = await this.computeHaul(tenantId, routeId, input);
    return this.formatHaul(haul);
  }

  /**
   * Where the time of every service goes (load / haul / unload / return), how
   * much of it is waste against the fleet's own best or a configured target,
   * who loses it, and where trucks stand idle.
   */
  public async haulAnalysis(
    tenantId: string,
    routeId: string | undefined,
    input: HaulAnalysisInput,
  ) {
    const targets: PhaseTargets = {
      loadSec: minutesToSec(input.targetLoadMin, 'targetLoadMin'),
      travelSec: minutesToSec(input.targetTravelMin, 'targetTravelMin'),
      unloadSec: minutesToSec(input.targetUnloadMin, 'targetUnloadMin'),
      returnSec: minutesToSec(input.targetReturnMin, 'targetReturnMin'),
    };
    const minStopSec = minutesToSec(input.stopMin, 'stopMin') ?? DEFAULT_MIN_STOP_SEC;
    const haul = await this.computeHaul(tenantId, routeId, input, { analysis: true, minStopSec });
    const analysis = analyzeHaul({
      measures: haul.measures,
      open: haul.detected.open,
      // A past range ends at its own `to`: an open haul is measured against that, not today.
      now: new Date(Math.min(Date.now(), haul.window.to.getTime())),
      targets,
    });
    return this.formatAnalysis(haul, analysis, minStopSec);
  }

  /** Services rolled up per day, week or month, with the vehicle / shift / driver split. */
  public async haulPeriods(
    tenantId: string,
    routeId: string | undefined,
    input: ReportQueryBase & { granularity?: string; calendar?: string },
  ) {
    const granularity = parseOption(input.granularity, PERIOD_GRANULARITIES, 'daily');
    const calendar = parseOption(input.calendar, PERIOD_CALENDARS, 'jalali');
    const haul = await this.computeHaul(tenantId, routeId, input);
    const periods = periodsBetween(
      localDate(haul.window.from, TIME_ZONE),
      localDate(new Date(haul.window.to.getTime() - 1), TIME_ZONE),
      granularity,
      calendar,
    );
    const rolled = summarizePeriods(
      haul.detected.cycles,
      periods,
      (cycle) => cycle.shiftDate ?? localDate(cycle.originEnteredAt, TIME_ZONE),
      granularity,
      calendar,
    );
    return {
      route: this.routeInfo(haul),
      from: haul.window.from.toISOString(),
      to: haul.window.to.toISOString(),
      granularity,
      calendar,
      truncated: haul.truncated,
      services: haul.detected.cycles.length,
      distanceKm: km(haul.detected.cycles.reduce((sum, cycle) => sum + cycle.distanceM, 0)),
      periods: rolled.periods.map((row) => ({
        key: row.key,
        from: row.from,
        to: row.to,
        services: row.services,
        distanceKm: km(row.distanceM),
        durationSec: row.durationSec,
        loadDwellSec: row.loadDwellSec,
        trucks: row.trucks,
        drivers: row.drivers,
        withoutDriver: row.withoutDriver,
      })),
      details: rolled.details.map((row) => ({
        period: row.period,
        vehicleId: row.vehicleId,
        vehicleName: haul.vehicleName.get(row.vehicleId) ?? row.vehicleId,
        shiftNo: row.shiftNo,
        driverId: row.driverId,
        driverName: row.driverName,
        services: row.services,
        distanceKm: km(row.distanceM),
        durationSec: row.durationSec,
        loadDwellSec: row.loadDwellSec,
      })),
    };
  }

  private routeInfo(haul: HaulComputation) {
    return {
      id: haul.route.id,
      name: haul.route.name,
      shiftStartHour: haul.route.shift_start_hour,
      shiftStartMinute: haul.route.shift_start_minute ?? 0,
      shiftDurationHours: haul.route.shift_duration_hours,
      shiftDurationMinutes: haul.route.shift_duration_minutes ?? 0,
      shiftCount: haul.shiftCount,
      lunchStartMinute: haul.route.lunch_start_minute,
      lunchEndMinute: haul.route.lunch_end_minute,
      handoverWindowMinutes: haul.route.handover_window_minutes ?? 30,
      timeZone: TIME_ZONE,
    };
  }

  private async computeHaul(
    tenantId: string,
    routeId: string | undefined,
    input: ReportQueryBase,
    options: { analysis: boolean; minStopSec?: number } = { analysis: false },
  ): Promise<HaulComputation> {
    if (!routeId || !UUID_RE.test(routeId)) {
      throw new ReportInputError('routeId must be a haul route id', 'INVALID_FILTER');
    }
    const route = await this.loadRoute(tenantId, routeId);
    const window = this.haulWindow(input, routeStartHour(route));
    const shiftCount = Math.min(
      maxShiftCount(routeDurationHours(route)),
      Math.max(1, route.shift_count),
    );
    const members = await this.loadMembers(tenantId, routeId);
    const origin = await this.loadZone(tenantId, route.origin_geofence_id);
    const destination = await this.loadZone(tenantId, route.destination_geofence_id);
    const vehicleIds = [
      ...new Set(members.map((row) => row.vehicle_id).filter((id): id is string => Boolean(id))),
    ];
    const drivers = await this.loadDrivers(tenantId, vehicleIds, window);
    const rosterIds = [
      ...new Set(members.flatMap((row) => parseUuidArray(row.shift_drivers)).filter(Boolean)),
    ] as string[];
    const driverNames = await this.loadDriverNames(tenantId, rosterIds);
    const tracks = new Map<string, readonly TrackSample[]>();
    const trucks: string[] = [];
    const shovels: string[] = [];
    const vehicleName = new Map<string, string>();
    const shovelLabel = new Map<string, string>();
    const unbound: Array<{ deviceId: string; imei: string | null; role: 'TRUCK' | 'SHOVEL' }> = [];
    const rosters = new Map<string, Array<RosterDriver | null>>();
    const shovelVehicle = new Map<string, string>();
    for (const member of members) {
      const label = member.vehicle_name ?? member.imei ?? member.device_id;
      if (member.role === 'SHOVEL') shovelLabel.set(member.device_id, member.imei ?? label);
      if (!member.vehicle_id) {
        unbound.push({ deviceId: member.device_id, imei: member.imei, role: member.role });
        continue;
      }
      vehicleName.set(member.vehicle_id, label);
      if (member.role === 'TRUCK') {
        if (!trucks.includes(member.vehicle_id)) trucks.push(member.vehicle_id);
        const roster = parseUuidArray(member.shift_drivers)
          .slice(0, shiftCount)
          .map((id) => {
            const name = id ? driverNames.get(id) : undefined;
            return id && name ? { driverId: id, driverName: name } : null;
          });
        if (roster.some(Boolean)) rosters.set(member.vehicle_id, roster);
      } else {
        shovels.push(member.device_id);
        shovelVehicle.set(member.device_id, member.vehicle_id);
      }
    }
    let truncated = false;
    // A shovel only matters while it stands inside the origin, so its track is
    // read from the origin's bounding box instead of in full.
    const box = zoneBounds(origin);
    for (const [deviceId, vehicleId] of shovelVehicle) {
      const loaded = await this.loadTrack(tenantId, vehicleId, window, box);
      truncated ||= loaded.truncated;
      tracks.set(deviceId, loaded.samples);
    }
    // Trucks are detected one at a time: each service lives on a single
    // truck's track, and only that track is held in memory at once.
    const cycles: HaulCycle[] = [];
    const open: OpenHaul[] = [];
    const measures: TruckMeasure[] = [];
    for (const truck of trucks) {
      const loaded = await this.loadTrack(tenantId, truck, window);
      truncated ||= loaded.truncated;
      const found = detectHaulCycles({
        trucks: [truck],
        shovels,
        tracks: new Map([...tracks, [truck, loaded.samples]]),
        origin,
        destination,
        drivers,
        rosters,
        shiftStartHour: routeStartHour(route),
        shiftDurationHours: routeDurationHours(route),
        shiftCount,
        timeZone: TIME_ZONE,
      });
      cycles.push(...found.cycles);
      open.push(...found.open);
      if (options.analysis) {
        measures.push(
          measureTruck({
            vehicleId: truck,
            samples: loaded.samples,
            cycles: found.cycles,
            origin,
            destination,
            drivers,
            rosters,
            shiftStartHour: routeStartHour(route),
            shiftDurationHours: routeDurationHours(route),
            shiftCount,
            timeZone: TIME_ZONE,
            minStopSec: options.minStopSec,
            breaks: policyOfRoute(route, TIME_ZONE),
          }),
        );
      }
    }
    cycles.sort((a, b) => a.originEnteredAt.getTime() - b.originEnteredAt.getTime());
    return {
      route,
      shiftCount,
      window,
      detected: { cycles, open },
      measures,
      truncated,
      vehicleName,
      shovelLabel,
      unbound,
    };
  }

  private formatHaul(haul: HaulComputation) {
    const { window, detected, vehicleName, shovelLabel, unbound } = haul;
    const summary = summarizeHauls(detected.cycles);
    return {
      route: this.routeInfo(haul),
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      truncated: haul.truncated,
      services: detected.cycles.length,
      distanceKm: km(detected.cycles.reduce((sum, cycle) => sum + cycle.distanceM, 0)),
      cycles: detected.cycles.map((cycle) => ({
        vehicleId: cycle.vehicleId,
        vehicleName: vehicleName.get(cycle.vehicleId) ?? cycle.vehicleId,
        shovelId: cycle.shovelId,
        shovelLabel: cycle.shovelId ? (shovelLabel.get(cycle.shovelId) ?? cycle.shovelId) : null,
        driverId: cycle.driverId,
        driverName: cycle.driverName,
        driverSource: cycle.driverSource,
        originEnteredAt: cycle.originEnteredAt.toISOString(),
        originLeftAt: cycle.originLeftAt.toISOString(),
        destinationEnteredAt: cycle.destinationEnteredAt.toISOString(),
        loadDwellSec: cycle.loadDwellSec,
        travelSec: cycle.travelSec,
        durationSec: cycle.durationSec,
        distanceKm: km(cycle.distanceM),
        shift: cycle.shift,
        shiftDate: cycle.shiftDate,
        shiftNo: cycle.shiftNo,
      })),
      byVehicle: summary.byVehicle.map((row) => ({
        vehicleId: row.vehicleId,
        vehicleName: vehicleName.get(row.vehicleId) ?? row.vehicleId,
        services: row.services,
        distanceKm: km(row.distanceM),
        durationSec: row.durationSec,
      })),
      byDriverShift: summary.byDriverShift.map((row) => ({
        driverId: row.driverId,
        driverName: row.driverName,
        shift: row.shift,
        shiftDate: row.shiftDate,
        shiftNo: row.shiftNo,
        vehicleNames: row.vehicleIds.map((id) => vehicleName.get(id) ?? id),
        services: row.services,
        distanceKm: km(row.distanceM),
        durationSec: row.durationSec,
      })),
      byShift: summary.byShift.map((row) => ({
        shift: row.shift,
        shiftDate: row.shiftDate,
        shiftNo: row.shiftNo,
        services: row.services,
        distanceKm: km(row.distanceM),
        durationSec: row.durationSec,
        loadDwellSec: row.loadDwellSec,
        trucks: row.trucks,
        drivers: row.drivers,
        withoutDriver: row.withoutDriver,
      })),
      byShovel: summary.byShovel.map((row) => ({
        shovelId: row.shovelId,
        shovelLabel: shovelLabel.get(row.shovelId) ?? row.shovelId,
        loads: row.loads,
      })),
      openHauls: detected.open.map((row) => ({
        vehicleId: row.vehicleId,
        vehicleName: vehicleName.get(row.vehicleId) ?? row.vehicleId,
        phase: row.phase,
        since: row.since.toISOString(),
      })),
      unbound,
    };
  }

  private formatAnalysis(
    haul: HaulComputation,
    analysis: ReturnType<typeof analyzeHaul>,
    minStopSec: number,
  ) {
    const name = (id: string) => haul.vehicleName.get(id) ?? id;
    const shovel = (id: string) => haul.shovelLabel.get(id) ?? id;
    const waste = (w: {
      loadSec: number;
      travelSec: number;
      unloadSec: number;
      returnSec: number;
      totalSec: number;
    }) => ({
      loadSec: Math.round(w.loadSec),
      travelSec: Math.round(w.travelSec),
      unloadSec: Math.round(w.unloadSec),
      returnSec: Math.round(w.returnSec),
      totalSec: Math.round(w.totalSec),
    });
    const budget = (b: typeof analysis.budget) => ({
      originSec: Math.round(b.originSec),
      destinationSec: Math.round(b.destinationSec),
      movingSec: Math.round(b.movingSec),
      idleOutsideSec: Math.round(b.idleOutsideSec),
      parkedSec: Math.round(b.parkedSec),
      noDataSec: Math.round(b.noDataSec),
      lunchSec: Math.round(b.lunchSec),
      handoverSec: Math.round(b.handoverSec),
    });
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    return {
      route: this.routeInfo(haul),
      from: haul.window.from.toISOString(),
      to: haul.window.to.toISOString(),
      truncated: haul.truncated,
      services: analysis.services,
      distanceKm: km(haul.detected.cycles.reduce((sum, cycle) => sum + cycle.distanceM, 0)),
      stopMinSec: minStopSec,
      references: analysis.references,
      cycleMedianSec: analysis.cycleMedianSec === null ? null : Math.round(analysis.cycleMedianSec),
      waste: waste(analysis.waste),
      wasteShare: analysis.wasteShare,
      lostServices:
        analysis.lostServices === null ? null : Math.round(analysis.lostServices * 10) / 10,
      timeBudget: budget(analysis.budget),
      stopCount: analysis.stopCount,
      stopSec: analysis.stopSec,
      plannedStops: analysis.plannedStops,
      withoutDriver: analysis.withoutDriver,
      controlLimits: {
        loadSec:
          analysis.references.load.p75Sec === null
            ? null
            : Math.round(analysis.references.load.p75Sec),
        unloadSec:
          analysis.references.unload.p75Sec === null
            ? null
            : Math.round(analysis.references.unload.p75Sec),
        stopSec: minStopSec,
      },
      byVehicle: analysis.byVehicle.map((row) => ({
        vehicleId: row.vehicleId,
        vehicleName: name(row.vehicleId),
        services: row.services,
        avgCycleSec: row.avgCycleSec,
        avgLoadSec: row.avgLoadSec,
        avgUnloadSec: row.avgUnloadSec,
        waste: waste(row.waste),
        timeBudget: budget(row.budget),
        stopCount: row.stopCount,
      })),
      byDriver: analysis.byDriver.map((row) => ({
        driverId: row.driverId,
        driverName: row.driverName,
        vehicleNames: row.vehicleIds.map(name),
        services: row.services,
        avgLoadSec: row.avgLoadSec,
        avgTravelSec: row.avgTravelSec,
        avgUnloadSec: row.avgUnloadSec,
        avgReturnSec: row.avgReturnSec,
        waste: waste(row.waste),
        wastePerServiceSec: row.wastePerServiceSec,
        stopCount: row.stopCount,
        stopSec: row.stopSec,
      })),
      byShift: analysis.byShift.map((row) => ({
        shift: row.shift,
        shiftDate: row.shiftDate,
        shiftNo: row.shiftNo,
        services: row.services,
        trucks: row.trucks,
        avgCycleSec: row.avgCycleSec,
        waste: waste(row.waste),
      })),
      byShovel: analysis.byShovel.map((row) => ({
        shovelId: row.shovelId,
        shovelLabel: shovel(row.shovelId),
        loads: row.loads,
        avgLoadSec: row.avgLoadSec,
        truckQueueSec: row.truckQueueSec,
        shovelIdleSec: row.shovelIdleSec,
      })),
      cycles: analysis.cycles.map((row) => {
        const cycle = row.timing.cycle;
        return {
          vehicleId: cycle.vehicleId,
          vehicleName: name(cycle.vehicleId),
          driverName: cycle.driverName,
          shovelLabel: cycle.shovelId ? shovel(cycle.shovelId) : null,
          shift: cycle.shift,
          shiftDate: cycle.shiftDate,
          shiftNo: cycle.shiftNo,
          originEnteredAt: cycle.originEnteredAt.toISOString(),
          destinationEnteredAt: cycle.destinationEnteredAt.toISOString(),
          destinationLeftAt: iso(row.timing.destinationLeftAt),
          loadSec: cycle.loadDwellSec,
          travelSec: cycle.travelSec,
          unloadSec: row.timing.unloadSec,
          returnSec: row.timing.returnSec,
          cycleSec: row.timing.cycleSec,
          wasteSec: Math.round(row.totalSec),
          wasteLoadSec: Math.round(row.loadSec),
          wasteTravelSec: Math.round(row.travelSec),
          wasteUnloadSec: Math.round(row.unloadSec),
          wasteReturnSec: Math.round(row.returnSec),
        };
      }),
      stops: analysis.stops.map((stop) => ({
        vehicleId: stop.vehicleId,
        vehicleName: name(stop.vehicleId),
        driverName: stop.driverName,
        startedAt: stop.startedAt.toISOString(),
        endedAt: stop.endedAt.toISOString(),
        durationSec: stop.durationSec,
        lat: stop.lat,
        lng: stop.lng,
        engineOn: stop.engineOn,
        phase: stop.phase,
        category: stop.category,
      })),
      openHauls: analysis.openHauls.map((row) => ({
        vehicleId: row.vehicleId,
        vehicleName: name(row.vehicleId),
        phase: row.phase,
        since: row.since.toISOString(),
        elapsedSec: row.elapsedSec,
        overdue: row.overdue,
      })),
      findings: analysis.findings.map((row) => ({
        code: row.code,
        subject: row.subject,
        subjectId: row.subjectId,
        subjectLabel:
          row.code === 'SHOVEL_QUEUE' || row.code === 'SHOVEL_STARVED'
            ? shovel(row.subjectId ?? '')
            : row.subject,
        value: Math.round(row.value),
        reference: row.reference === null ? null : Math.round(row.reference),
      })),
      unbound: haul.unbound,
    };
  }

  private window(input: ReportQueryBase): ReportWindow {
    const parsed = parseReportWindow({ preset: input.preset, from: input.from, to: input.to });
    if (parsed.error) {
      throw new ReportInputError(reportWindowErrorMessage(parsed.error, 92), parsed.error);
    }
    return parsed.window;
  }

  /** Presets follow the route's work day; a custom range is used as given. */
  private haulWindow(input: ReportQueryBase, shiftStartHour: number): ReportWindow {
    const window = this.window(input);
    const preset = input.preset?.trim();
    if (!preset) return window;
    return shiftDayWindow(preset, shiftStartHour, TIME_ZONE, new Date()) ?? window;
  }

  private async query<T>(fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    return this.knex.transaction(async (trx) => {
      await trx.raw('SET LOCAL TRANSACTION READ ONLY');
      await trx.raw(`SET LOCAL statement_timeout = '${Math.floor(this.queryTimeoutMs)}'`);
      return fn(trx);
    });
  }

  private async loadRoute(tenantId: string, routeId: string) {
    const { rows } = await this.query<{ rows: RouteRow[] }>((trx) =>
      trx.raw(
        `SELECT id, name, origin_geofence_id, destination_geofence_id,
                shift_start_hour, shift_start_minute,
                shift_duration_hours, shift_duration_minutes, shift_count,
                lunch_start_minute, lunch_end_minute, handover_window_minutes
         FROM fleet.haul_routes
         WHERE tenant_id = ?::uuid AND id = ?::uuid AND status = 'ACTIVE'`,
        [tenantId, routeId],
      ),
    );
    const route = rows[0];
    if (!route) throw new ReportInputError('Haul route not found', 'INVALID_FILTER');
    return route;
  }

  private async loadMembers(tenantId: string, routeId: string): Promise<MemberRow[]> {
    const { rows } = await this.query<{ rows: MemberRow[] }>((trx) =>
      trx.raw(
        `SELECT m.device_id, m.role, m.shift_drivers, d.imei, vd.vehicle_id, v.name AS vehicle_name
         FROM fleet.haul_members m
         JOIN fleet.devices d ON d.id = m.device_id AND d.tenant_id = m.tenant_id
         LEFT JOIN fleet.vehicle_devices vd
           ON vd.device_id = d.id AND vd.tenant_id = d.tenant_id
         LEFT JOIN fleet.vehicles v ON v.id = vd.vehicle_id AND v.tenant_id = d.tenant_id
         WHERE m.tenant_id = ?::uuid AND m.route_id = ?::uuid`,
        [tenantId, routeId],
      ),
    );
    return rows;
  }

  private async loadZone(tenantId: string, geofenceId: string): Promise<Zone> {
    const { rows } = await this.query<{ rows: GeofenceRow[] }>((trx) =>
      trx.raw(
        `SELECT id, geofence_type,
                ST_Y(center::geometry) AS lat,
                ST_X(center::geometry) AS lng,
                radius_m,
                ST_AsGeoJSON(boundary::geometry) AS boundary
         FROM tracking.geofences
         WHERE tenant_id = ?::uuid AND id = ?::uuid`,
        [tenantId, geofenceId],
      ),
    );
    const row = rows[0];
    if (!row) throw new ReportInputError('Haul geofence not found', 'INVALID_FILTER');
    return zoneFrom(row);
  }

  /** One machine's fixes in the window, oldest first, optionally inside a bounding box. */
  private async loadTrack(
    tenantId: string,
    vehicleId: string,
    window: ReportWindow,
    box?: ZoneBounds,
  ): Promise<{ samples: TrackSample[]; truncated: boolean }> {
    const { rows } = await this.query<{ rows: PointRow[] }>((trx) =>
      trx.raw(
        `SELECT vehicle_id, captured_at, latitude, longitude, speed_kmh, ignition_on
         FROM tracking.vehicle_positions
         WHERE tenant_id = ?::uuid
           AND vehicle_id = ?::uuid
           AND quality IN (1, 3)
           AND captured_at >= ? AND captured_at < ?
           ${box ? 'AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?' : ''}
         ORDER BY captured_at
         LIMIT ${TRACK_POSITION_CAP}`,
        [
          tenantId,
          vehicleId,
          window.from,
          window.to,
          ...(box ? [box.minLat, box.maxLat, box.minLng, box.maxLng] : []),
        ],
      ),
    );
    return {
      samples: rows.map((point) => ({
        at: asDate(point.captured_at),
        lat: num(point.latitude),
        lng: num(point.longitude),
        speedKmh: point.speed_kmh === null ? null : num(point.speed_kmh),
        ignitionOn: point.ignition_on,
      })),
      truncated: rows.length >= TRACK_POSITION_CAP,
    };
  }

  private async loadDrivers(
    tenantId: string,
    vehicleIds: readonly string[],
    window: ReportWindow,
  ): Promise<DriverInterval[]> {
    if (vehicleIds.length === 0) return [];
    const { rows } = await this.query<{ rows: DriverRow[] }>((trx) =>
      trx.raw(
        `SELECT a.vehicle_id, a.driver_id, a.started_at, a.ended_at, a.shift_no,
                BTRIM(d.first_name || ' ' || d.last_name) AS driver_name
         FROM fleet.driver_assignments a
         JOIN fleet.drivers d ON d.id = a.driver_id AND d.tenant_id = a.tenant_id
         WHERE a.tenant_id = ?::uuid
           AND a.vehicle_id = ANY(?::uuid[])
           AND a.started_at < ?
           AND (a.ended_at IS NULL OR a.ended_at > ?)`,
        [tenantId, vehicleIds, window.to, window.from],
      ),
    );
    return rows.map((row) => ({
      vehicleId: row.vehicle_id,
      driverId: row.driver_id,
      driverName: row.driver_name,
      startedAt: asDate(row.started_at),
      endedAt: row.ended_at ? asDate(row.ended_at) : null,
      shiftNo: row.shift_no ?? null,
    }));
  }

  private async loadDriverNames(
    tenantId: string,
    driverIds: readonly string[],
  ): Promise<Map<string, string>> {
    if (driverIds.length === 0) return new Map();
    const { rows } = await this.query<{ rows: Array<{ id: string; driver_name: string }> }>((trx) =>
      trx.raw(
        `SELECT id, BTRIM(first_name || ' ' || last_name) AS driver_name
           FROM fleet.drivers
           WHERE tenant_id = ?::uuid AND id = ANY(?::uuid[])`,
        [tenantId, driverIds],
      ),
    );
    return new Map(rows.map((row) => [row.id, row.driver_name]));
  }
}

const ACTIVITY_SQL = `
WITH roster AS (
  SELECT d.id AS device_id, d.imei, d.protocol, d.status,
         vd.vehicle_id, v.name AS vehicle_name, v.code AS vehicle_code, v.plate
  FROM fleet.devices d
  LEFT JOIN fleet.vehicle_devices vd
    ON vd.device_id = d.id AND vd.tenant_id = d.tenant_id
  LEFT JOIN fleet.vehicles v
    ON v.id = vd.vehicle_id AND v.tenant_id = d.tenant_id
  WHERE d.tenant_id = ?::uuid AND d.status <> 'DECOMMISSIONED'
),
window_fixes AS (
  SELECT pos.vehicle_id, pos.captured_at, pos.latitude, pos.longitude,
         LAG(pos.captured_at) OVER (PARTITION BY pos.vehicle_id ORDER BY pos.captured_at) AS prev_at,
         LAG(pos.latitude) OVER (PARTITION BY pos.vehicle_id ORDER BY pos.captured_at) AS prev_lat,
         LAG(pos.longitude) OVER (PARTITION BY pos.vehicle_id ORDER BY pos.captured_at) AS prev_lng
  FROM tracking.vehicle_positions pos
  WHERE pos.tenant_id = ?::uuid
    AND pos.quality IN (1, 3)
    AND pos.captured_at >= ? AND pos.captured_at < ?
    AND pos.vehicle_id IN (SELECT vehicle_id FROM roster WHERE vehicle_id IS NOT NULL)
),
step AS (
  SELECT vehicle_id, captured_at,
         (captured_at AT TIME ZONE '${TIME_ZONE}')::date AS day,
         CASE WHEN prev_at IS NULL THEN NULL
              ELSE EXTRACT(EPOCH FROM (captured_at - prev_at)) END AS dt_sec,
         CASE WHEN prev_at IS NULL THEN NULL
              ELSE 6371000 * 2 * asin(LEAST(1::float8, sqrt(
                power(sin(radians(latitude - prev_lat) / 2), 2)
                + cos(radians(prev_lat)) * cos(radians(latitude))
                  * power(sin(radians(longitude - prev_lng) / 2), 2)
              ))) END AS meters
  FROM window_fixes
),
per_day AS (
  SELECT vehicle_id, day,
         COUNT(*)::int AS fixes,
         MIN(captured_at) AS first_fix,
         MAX(captured_at) AS last_fix,
         COALESCE(SUM(CASE WHEN dt_sec > 300 THEN dt_sec - 300 ELSE 0 END), 0) AS gap_offline_sec,
         COALESCE(SUM(CASE
           WHEN dt_sec > 1 AND meters > 1 AND (meters * 3.6 / dt_sec) <= 100 THEN meters
           ELSE 0 END), 0) AS distance_m
  FROM step
  GROUP BY vehicle_id, day
),
lifetime AS (
  SELECT pos.vehicle_id, MIN(pos.captured_at) AS started_at
  FROM tracking.vehicle_positions pos
  WHERE pos.tenant_id = ?::uuid
    AND pos.quality IN (1, 3)
    AND pos.vehicle_id IN (SELECT vehicle_id FROM roster WHERE vehicle_id IS NOT NULL)
  GROUP BY pos.vehicle_id
)
SELECT r.device_id, r.imei, r.protocol, r.status,
       r.vehicle_id, r.vehicle_name, r.vehicle_code, r.plate,
       to_char(p.day, 'YYYY-MM-DD') AS day,
       p.first_fix,
       COALESCE(p.fixes, 0) AS fixes,
       p.last_fix,
       COALESCE(p.distance_m, 0) AS distance_m,
       CASE
         WHEN r.vehicle_id IS NULL OR l.started_at IS NULL THEN NULL
         WHEN p.last_fix IS NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (?::timestamptz - ?::timestamptz)) - 300)
         ELSE COALESCE(p.gap_offline_sec, 0) + CASE
           WHEN p.day = (?::timestamptz AT TIME ZONE '${TIME_ZONE}')::date
             AND EXTRACT(EPOCH FROM (?::timestamptz - p.last_fix)) > 300
           THEN EXTRACT(EPOCH FROM (?::timestamptz - p.last_fix)) - 300
           ELSE 0 END
       END AS offline_sec
FROM roster r
LEFT JOIN lifetime l ON l.vehicle_id = r.vehicle_id
LEFT JOIN per_day p ON p.vehicle_id = r.vehicle_id
ORDER BY r.vehicle_name NULLS LAST, r.imei, p.day
`;

const NATURAL = new Intl.Collator('fa', { numeric: true, sensitivity: 'base' });

function isString(value: string | null): value is string {
  return value !== null;
}

/** Machine name in natural order (712 before 1251), then the day. */
function byMachineThenDay(
  a: { vehicleName: string | null; imei: string; day: string | null },
  b: { vehicleName: string | null; imei: string; day: string | null },
): number {
  if ((a.vehicleName === null) !== (b.vehicleName === null)) return a.vehicleName === null ? 1 : -1;
  return (
    NATURAL.compare(a.vehicleName ?? '', b.vehicleName ?? '') ||
    a.imei.localeCompare(b.imei) ||
    (a.day ?? '').localeCompare(b.day ?? '')
  );
}

function toActivity(row: ActivityRow, drivers: readonly DriverInterval[]) {
  const startedAt = row.first_fix ? asDate(row.first_fix) : null;
  const endedAt = row.last_fix ? asDate(row.last_fix) : null;
  const names =
    row.vehicle_id && startedAt && endedAt
      ? [
          ...new Set(
            drivers
              .filter(
                (d) =>
                  d.vehicleId === row.vehicle_id &&
                  d.startedAt <= endedAt &&
                  (d.endedAt === null || d.endedAt >= startedAt),
              )
              .map((d) => d.driverName),
          ),
        ]
      : [];
  return {
    deviceId: row.device_id,
    imei: row.imei,
    protocol: row.protocol,
    status: row.status,
    vehicleId: row.vehicle_id,
    vehicleName: row.vehicle_name,
    vehicleCode: row.vehicle_code,
    plate: row.plate,
    day: row.day,
    startedAt: startedAt ? startedAt.toISOString() : null,
    endedAt: endedAt ? endedAt.toISOString() : null,
    driverName: names.length > 0 ? names.join('، ') : null,
    fixes: Math.round(num(row.fixes)),
    offlineSec: row.offline_sec === null ? null : Math.round(num(row.offline_sec)),
    distanceKm: km(num(row.distance_m)),
    silent: row.vehicle_id === null || row.first_fix === null,
  };
}

function zoneFrom(row: GeofenceRow): Zone {
  if (
    row.geofence_type === 'CIRCLE' &&
    row.lat !== null &&
    row.lng !== null &&
    row.radius_m !== null
  ) {
    return { kind: 'circle', lat: num(row.lat), lng: num(row.lng), radiusM: num(row.radius_m) };
  }
  const geo =
    typeof row.boundary === 'string'
      ? (JSON.parse(row.boundary) as GeofenceRow['boundary'])
      : row.boundary;
  const ring = geo && typeof geo === 'object' && geo.coordinates ? geo.coordinates[0] : undefined;
  if (!ring || ring.length < 3) {
    throw new ReportInputError('Haul geofence has no usable boundary', 'INVALID_FILTER');
  }
  return {
    kind: 'polygon',
    ring: ring.map((pair) => [Number(pair[0]), Number(pair[1])] as const),
  };
}

/** node-postgres returns uuid[] as an array; tolerate the `{a,NULL}` text form too. */
function parseUuidArray(value: Array<string | null> | string | null): Array<string | null> {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((id) => (id && UUID_RE.test(id) ? id : null));
  return value
    .replace(/^{|}$/g, '')
    .split(',')
    .map((id) => id.trim())
    .map((id) => (UUID_RE.test(id) ? id : null));
}

function num(value: number | string | null | undefined): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function km(meters: number): number {
  return Math.round((meters / 1000) * 1000) / 1000;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
