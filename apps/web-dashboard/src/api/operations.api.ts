/**
 * Mine operations — device activity and haul cycles.
 *
 * Activity and cycle reports come from reporting-service as raw bodies.
 * Haul route CRUD comes from fleet-management inside the `{ data }` envelope.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ReportRange } from './report.api';

import { apiDeleteNoContent, apiGet, apiGetRaw, apiPatch, apiPost, apiPut } from './client';

export type ReportPreset = 'today' | 'yesterday' | '7d' | '30d';

/** Same shape the reports page uses: a preset, or a custom from/to. */
export type OperationsRange = ReportRange;

function rangeParams(range: OperationsRange, extra: Record<string, unknown> = {}) {
  return {
    ...(range.preset ? { preset: range.preset } : {}),
    ...(range.from ? { from: range.from } : {}),
    ...(range.to ? { to: range.to } : {}),
    ...extra,
  };
}

export type PeriodGranularity = 'daily' | 'weekly' | 'monthly';
export type PeriodCalendar = 'jalali' | 'gregorian';

export interface DeviceActivityRow {
  deviceId: string;
  imei: string;
  protocol: string;
  status: string;
  vehicleId: string | null;
  vehicleName: string | null;
  vehicleCode: string | null;
  plate: string | null;
  startedAt: string | null;
  fixes: number;
  lastFixAt: string | null;
  offlineSec: number | null;
  distanceKm: number;
  silent: boolean;
}

export interface DeviceActivityReport {
  from: string;
  to: string;
  totalDistanceKm: number;
  silentCount: number;
  reportingCount: number;
  devices: DeviceActivityRow[];
}

export interface HaulRoute {
  id: string;
  name: string;
  originGeofenceId: string;
  destinationGeofenceId: string;
  shiftStartHour: number;
  /** Minute past `shiftStartHour` (0-59). */
  shiftStartMinute: number;
  shiftDurationHours: number;
  /** Minutes added to `shiftDurationHours` (0-59). */
  shiftDurationMinutes: number;
  /** Back-to-back shifts in one work day (two by default). */
  shiftCount: number;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface HaulRouteInput {
  name: string;
  originGeofenceId: string;
  destinationGeofenceId: string;
  shiftStartHour: number;
  shiftStartMinute: number;
  shiftDurationHours: number;
  shiftDurationMinutes: number;
  shiftCount: number;
}

export type MachineRole = 'TRUCK' | 'SHOVEL';

export interface HaulMember {
  id: string;
  deviceId: string;
  role: MachineRole;
  imei: string | null;
  /** Element `n - 1` is the driver of shift `n`. */
  shiftDrivers: Array<string | null>;
}

export interface HaulMemberInput {
  deviceId: string;
  /** Left out, the server uses the machine type defined on the vehicle. */
  role?: MachineRole;
  shiftDrivers?: Array<string | null>;
}

export interface HaulCycleRow {
  vehicleId: string;
  vehicleName: string;
  shovelId: string | null;
  shovelLabel: string | null;
  driverId: string | null;
  driverName: string | null;
  driverSource: 'ROSTER' | 'ASSIGNMENT' | null;
  originEnteredAt: string;
  originLeftAt: string;
  destinationEnteredAt: string;
  loadDwellSec: number;
  travelSec: number;
  durationSec: number;
  distanceKm: number;
  shift: string;
  shiftDate: string | null;
  shiftNo: number;
}

export interface HaulShiftRow {
  shift: string;
  shiftDate: string | null;
  shiftNo: number;
  services: number;
  distanceKm: number;
  durationSec: number;
  loadDwellSec: number;
  trucks: number;
  drivers: number;
  withoutDriver: number;
}

export interface HaulCycleReport {
  route: {
    id: string;
    name: string;
    shiftStartHour: number;
    shiftStartMinute?: number;
    shiftDurationHours: number;
    shiftDurationMinutes?: number;
    shiftCount: number;
    timeZone: string;
  };
  from: string;
  to: string;
  truncated: boolean;
  services: number;
  distanceKm: number;
  cycles: HaulCycleRow[];
  byVehicle: Array<{
    vehicleId: string;
    vehicleName: string;
    services: number;
    distanceKm: number;
    durationSec: number;
  }>;
  byDriverShift: Array<{
    driverId: string;
    driverName: string;
    shift: string;
    shiftDate: string | null;
    shiftNo: number;
    vehicleNames: string[];
    services: number;
    distanceKm: number;
    durationSec: number;
  }>;
  byShift: HaulShiftRow[];
  byShovel: Array<{ shovelId: string; shovelLabel: string; loads: number }>;
  openHauls: Array<{
    vehicleId: string;
    vehicleName: string;
    phase: 'LOADING' | 'HAULING';
    since: string;
  }>;
  unbound: Array<{ deviceId: string; imei: string | null; role: 'TRUCK' | 'SHOVEL' }>;
}

export interface HaulPeriodRow {
  /** Sort key: a date, or `YYYY-MM` for months. */
  key: string;
  /** First and last local work day of the period (`YYYY-MM-DD`). */
  from: string;
  to: string;
  services: number;
  distanceKm: number;
  durationSec: number;
  loadDwellSec: number;
  trucks: number;
  drivers: number;
  withoutDriver: number;
}

export interface HaulPeriodDetail {
  period: string;
  vehicleId: string;
  vehicleName: string;
  shiftNo: number;
  driverId: string | null;
  driverName: string | null;
  services: number;
  distanceKm: number;
  durationSec: number;
  loadDwellSec: number;
}

export interface HaulPeriodReport {
  route: HaulCycleReport['route'];
  from: string;
  to: string;
  granularity: PeriodGranularity;
  calendar: PeriodCalendar;
  truncated: boolean;
  services: number;
  distanceKm: number;
  periods: HaulPeriodRow[];
  details: HaulPeriodDetail[];
}

export type AnalysisPhase = 'load' | 'travel' | 'unload' | 'return';

export interface PhaseReference {
  samples: number;
  /** What the phase should take; everything above is waste. */
  referenceSec: number | null;
  medianSec: number | null;
  p75Sec: number | null;
  maxSec: number | null;
  source: 'CONFIGURED' | 'FLEET' | 'NONE';
}

export interface WasteTotals {
  loadSec: number;
  travelSec: number;
  unloadSec: number;
  returnSec: number;
  totalSec: number;
}

export interface TimeBudget {
  originSec: number;
  destinationSec: number;
  movingSec: number;
  idleOutsideSec: number;
  parkedSec: number;
  noDataSec: number;
}

export type AnalysisFindingCode =
  | 'DRIVER_SLOW_LOAD'
  | 'DRIVER_SLOW_UNLOAD'
  | 'DRIVER_LONG_STOPS'
  | 'SHOVEL_QUEUE'
  | 'SHOVEL_STARVED'
  | 'NO_DRIVER'
  | 'LOW_DATA'
  | 'LOAD_IS_BIGGEST';

export interface HaulAnalysisReport {
  route: HaulCycleReport['route'];
  from: string;
  to: string;
  truncated: boolean;
  services: number;
  distanceKm: number;
  stopMinSec: number;
  references: Record<AnalysisPhase, PhaseReference>;
  cycleMedianSec: number | null;
  waste: WasteTotals;
  /** Waste as a share (0–1) of all measured phase time. */
  wasteShare: number | null;
  /** Waste expressed in services the fleet could have made with it. */
  lostServices: number | null;
  timeBudget: TimeBudget;
  stopCount: number;
  stopSec: number;
  withoutDriver: number;
  controlLimits: { loadSec: number | null; unloadSec: number | null; stopSec: number };
  byVehicle: Array<{
    vehicleId: string;
    vehicleName: string;
    services: number;
    avgCycleSec: number | null;
    avgLoadSec: number | null;
    avgUnloadSec: number | null;
    waste: WasteTotals;
    timeBudget: TimeBudget;
    stopCount: number;
  }>;
  byDriver: Array<{
    driverId: string;
    driverName: string;
    vehicleNames: string[];
    services: number;
    avgLoadSec: number | null;
    avgTravelSec: number | null;
    avgUnloadSec: number | null;
    avgReturnSec: number | null;
    waste: WasteTotals;
    wastePerServiceSec: number;
    stopCount: number;
    stopSec: number;
  }>;
  byShift: Array<{
    shift: string;
    shiftDate: string | null;
    shiftNo: number;
    services: number;
    trucks: number;
    avgCycleSec: number | null;
    waste: WasteTotals;
  }>;
  byShovel: Array<{
    shovelId: string;
    shovelLabel: string;
    loads: number;
    avgLoadSec: number | null;
    truckQueueSec: number;
    shovelIdleSec: number;
  }>;
  cycles: Array<{
    vehicleId: string;
    vehicleName: string;
    driverName: string | null;
    shovelLabel: string | null;
    shift: string;
    shiftDate: string | null;
    shiftNo: number;
    originEnteredAt: string;
    destinationEnteredAt: string;
    destinationLeftAt: string | null;
    loadSec: number;
    travelSec: number;
    unloadSec: number | null;
    returnSec: number | null;
    cycleSec: number | null;
    wasteSec: number;
    wasteLoadSec: number;
    wasteTravelSec: number;
    wasteUnloadSec: number;
    wasteReturnSec: number;
  }>;
  stops: Array<{
    vehicleId: string;
    vehicleName: string;
    driverName: string | null;
    startedAt: string;
    endedAt: string;
    durationSec: number;
    lat: number;
    lng: number;
    engineOn: boolean;
    phase: 'LOADED' | 'EMPTY';
  }>;
  openHauls: Array<{
    vehicleId: string;
    vehicleName: string;
    phase: 'LOADING' | 'HAULING';
    since: string;
    elapsedSec: number;
    overdue: boolean;
  }>;
  findings: Array<{
    code: AnalysisFindingCode;
    subject: string | null;
    subjectId: string | null;
    subjectLabel: string | null;
    value: number;
    reference: number | null;
  }>;
  unbound: HaulCycleReport['unbound'];
}

/** Targets in minutes; a blank field uses the fleet's own best time. */
export interface AnalysisTargets {
  targetLoadMin?: string;
  targetTravelMin?: string;
  targetUnloadMin?: string;
  targetReturnMin?: string;
  stopMin?: string;
}

export function useDeviceActivity(range: OperationsRange) {
  return useQuery({
    queryKey: ['reports', 'device-activity', range],
    queryFn: () => apiGetRaw<DeviceActivityReport>('/reports/device-activity', rangeParams(range)),
  });
}

export function useHaulRoutes() {
  return useQuery({
    queryKey: ['haul-routes'],
    queryFn: () => apiGet<HaulRoute[]>('/haul-routes'),
  });
}

export function useHaulMembers(routeId: string | null) {
  return useQuery({
    queryKey: ['haul-routes', routeId, 'members'],
    queryFn: () => apiGet<HaulMember[]>(`/haul-routes/${routeId}/members`),
    enabled: Boolean(routeId),
  });
}

export function useHaulCycles(routeId: string | null, range: OperationsRange) {
  return useQuery({
    queryKey: ['reports', 'haul-cycles', routeId, range],
    queryFn: () =>
      apiGetRaw<HaulCycleReport>('/reports/haul-cycles', rangeParams(range, { routeId })),
    enabled: Boolean(routeId),
  });
}

export function useHaulPeriods(
  routeId: string | null,
  range: OperationsRange,
  granularity: PeriodGranularity,
  calendar: PeriodCalendar,
) {
  return useQuery({
    queryKey: ['reports', 'haul-periods', routeId, range, granularity, calendar],
    queryFn: () =>
      apiGetRaw<HaulPeriodReport>(
        '/reports/haul-periods',
        rangeParams(range, { routeId, granularity, calendar }),
      ),
    enabled: Boolean(routeId),
  });
}

export function useHaulAnalysis(
  routeId: string | null,
  range: OperationsRange,
  targets: AnalysisTargets,
) {
  const given = Object.fromEntries(
    Object.entries(targets).filter(([, value]) => typeof value === 'string' && value.trim() !== ''),
  );
  return useQuery({
    queryKey: ['reports', 'haul-analysis', routeId, range, given],
    queryFn: () =>
      apiGetRaw<HaulAnalysisReport>(
        '/reports/haul-analysis',
        rangeParams(range, { routeId, ...given }),
      ),
    enabled: Boolean(routeId),
  });
}

export function useCreateHaulRoute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: HaulRouteInput) => apiPost<HaulRouteInput, HaulRoute>('/haul-routes', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['haul-routes'] }),
  });
}

export function useUpdateHaulRoute(routeId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<HaulRouteInput>) =>
      apiPatch<Partial<HaulRouteInput>, HaulRoute>(`/haul-routes/${routeId}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['haul-routes'] });
      void queryClient.invalidateQueries({ queryKey: ['reports', 'haul-cycles', routeId] });
    },
  });
}

export function useArchiveHaulRoute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (routeId: string) => apiDeleteNoContent(`/haul-routes/${routeId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['haul-routes'] }),
  });
}

export function useSetHaulMembers(routeId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (members: HaulMemberInput[]) =>
      apiPut<{ members: HaulMemberInput[] }, HaulMember[]>(`/haul-routes/${routeId}/members`, {
        members,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['haul-routes', routeId, 'members'] });
      void queryClient.invalidateQueries({ queryKey: ['reports', 'haul-cycles', routeId] });
    },
  });
}
