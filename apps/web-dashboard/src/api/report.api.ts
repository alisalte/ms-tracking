/**
 * Reporting API + data hooks — REAL backend (Sprint J).
 *
 * Source: reporting-service (`GET /reports/*`, port 3011 via the dev proxy).
 * Every number comes from the backend's documented KPI formulas
 * (docs/implementation/REPORTING-KPI-DEFINITIONS.md) — the frontend only
 * formats and displays (§66). No mock analytics: on network error the hooks
 * surface ErrorState; the old mock plumbing is gone.
 */
import { useQuery } from '@tanstack/react-query';

import { downloadBlob } from '@/lib/video-stream';
import { apiGetBlob, apiGetRaw } from './client';

// ── Wire types (raw reporting-service responses) ─────────────────────────────

export type ReportPresetId = 'today' | 'yesterday' | '7d' | '30d';

export interface ReportRange {
  preset?: ReportPresetId;
  from?: string;
  to?: string;
}

export interface FleetOverviewResponse {
  totalVehicles: number;
  vehiclesWithTelemetry: number;
  noTelemetryVehicles: number;
  movingVehicles: number;
  idleVehicles: number;
  parkedVehicles: number;
  totalDistanceKm: number;
  totalTrips: number;
  totalAlarms: number;
  openAlarms: number;
  geofenceEvents: number;
  avgUtilizationPct: number | null;
  /** SUM completed trip duration (KPI: Moving duration). */
  movingDurationSec: number;
  /** SUM closed idle periods (KPI: Idle duration). */
  idleDurationSec: number;
  /** SUM ENDED parking periods (KPI: Parking duration). */
  parkingDurationSec: number;
  /** distance / moving-hours; null when no completed trips. */
  avgSpeedKmh: number | null;
  /** MAX trip max_speed; null when no completed trips. */
  maxSpeedKmh: number | null;
  /** Count of overspeed alerts in range. */
  speedingEventCount: number;
  discardedTrips: number;
  from: string;
  to: string;
  dataAsOf: string;
  freshness: 'NEAR_REALTIME' | 'AGGREGATED';
}

export interface TrendPointWire {
  day: string;
  distanceKm: number;
  trips: number;
  alarms: number;
  alarmSpeeding: number;
  alarmGeofence: number;
  alarmOffline: number;
  alarmOther: number;
}

export interface TrendResponse {
  points: TrendPointWire[];
  from: string;
  to: string;
  dataAsOf: string;
  freshness: 'AGGREGATED';
}

export interface VehicleMetersRowWire {
  vehicleId: string;
  label: string;
  odometerKm: number | null;
  periodDistanceKm: number;
  trips: number;
  engineHours: number | null;
  periodEngineHoursSec: number;
  movingSec: number;
  idleSec: number;
  parkingSec: number;
}

export interface UtilizationRowWire {
  vehicleId: string;
  label: string;
  movingSec: number;
  idleSec: number;
  parkingSec: number;
  observedSec: number | null;
  utilizationPct: number | null;
  distanceKm: number;
  trips: number;
}

export interface TripRowWire {
  id: string;
  vehicleId: string;
  label: string;
  startedAt: string;
  endedAt: string | null;
  durationSec: number;
  distanceKm: number;
  avgSpeedKph: number | null;
  maxSpeedKph: number;
  startLat: number;
  startLng: number;
  endLat: number | null;
  endLng: number | null;
  idleSec: number;
  parkingSec: number;
}

export interface DistanceRowWire {
  vehicleId: string;
  label: string;
  distanceKm: number;
  trips: number;
  avgTripKm: number | null;
  maxTripKm: number | null;
  discardedTrips: number;
}

export interface SpeedRowWire {
  vehicleId: string;
  label: string;
  avgSpeedKph: number | null;
  maxSpeedKph: number | null;
  speedingAlarms: number;
}

export interface PeriodRowWire {
  id: string;
  kind: 'IDLE' | 'PARKING';
  vehicleId: string;
  label: string;
  startedAt: string;
  endedAt: string | null;
  durationSec: number;
  lat: number | null;
  lng: number | null;
  status: string | null;
  /** OPERATIONAL = a stop of the machine; LUNCH / HANDOVER follow the route's schedule. */
  category?: 'OPERATIONAL' | 'LUNCH' | 'HANDOVER';
}

/** Idle / parking periods split into the machine's own stops and the planned ones. */
export interface PlannedStopSummaryWire {
  operational: { count: number; sec: number };
  lunch: { count: number; sec: number };
  handover: { count: number; sec: number };
  /** The scan hit its cap: the totals cover only the newest periods. */
  truncated: boolean;
}

export interface AlarmAggRowWire {
  vehicleId: string | null;
  label: string | null;
  type: string;
  severity: string;
  total: number;
  open: number;
  acknowledged: number;
  resolved: number;
}

export interface AlarmSummaryWire {
  total: number;
  open: number;
  acknowledged: number;
  resolved: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface GeofenceReportRowWire {
  geofenceId: string | null;
  geofenceName: string | null;
  vehicleId: string | null;
  label: string | null;
  enters: number;
  exits: number;
  dwells: number;
  timeInsideSec: number;
}

export interface ActivityEventWire {
  at: string;
  source: string;
  kind: string;
  vehicleId: string | null;
  label: string | null;
  detail: string | null;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function rangeParams(range: ReportRange, extra: Record<string, unknown> = {}) {
  return {
    ...(range.preset ? { preset: range.preset } : {}),
    ...(range.from ? { from: range.from } : {}),
    ...(range.to ? { to: range.to } : {}),
    ...extra,
  };
}

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useFleetOverview(
  range: ReportRange,
  filters: { vehicleId?: string; fleetId?: string } = {},
) {
  return useQuery({
    queryKey: ['reports', 'overview', range, filters],
    queryFn: () =>
      apiGetRaw<FleetOverviewResponse>('/reports/fleet-overview', rangeParams(range, filters)),
    staleTime: 30_000,
  });
}

export function useTrend(
  range: ReportRange,
  filters: { vehicleId?: string; fleetId?: string } = {},
) {
  return useQuery({
    queryKey: ['reports', 'trend', range, filters],
    queryFn: () => apiGetRaw<TrendResponse>('/reports/trend', rangeParams(range, filters)),
    staleTime: 30_000,
  });
}

export function useUtilization(
  range: ReportRange,
  filters: { vehicleId?: string; fleetId?: string } = {},
) {
  return useQuery({
    queryKey: ['reports', 'utilization', range, filters],
    queryFn: () =>
      apiGetRaw<{ items: UtilizationRowWire[]; total: number }>(
        '/reports/vehicle-utilization',
        rangeParams(range, filters),
      ),
  });
}

export function useTrips(
  range: ReportRange,
  filters: { vehicleId?: string; fleetId?: string } = {},
) {
  return useQuery({
    queryKey: ['reports', 'trips', range, filters],
    queryFn: () =>
      apiGetRaw<{ items: TripRowWire[]; nextCursor: string | null }>(
        '/reports/trips',
        rangeParams(range, { ...filters, limit: 50 }),
      ),
  });
}

export function useDistance(
  range: ReportRange,
  filters: { vehicleId?: string; fleetId?: string } = {},
) {
  return useQuery({
    queryKey: ['reports', 'distance', range, filters],
    queryFn: () =>
      apiGetRaw<{ items: DistanceRowWire[]; total: number }>(
        '/reports/distance',
        rangeParams(range, filters),
      ),
  });
}

export function useSpeed(
  range: ReportRange,
  filters: { vehicleId?: string; fleetId?: string } = {},
) {
  return useQuery({
    queryKey: ['reports', 'speed', range, filters],
    queryFn: () =>
      apiGetRaw<{ items: SpeedRowWire[]; total: number }>(
        '/reports/speed',
        rangeParams(range, filters),
      ),
  });
}

export interface SpeedingFixWire {
  at: string;
  lat: number;
  lng: number;
  speedKmh: number;
}

export interface SpeedingDiscardedFixWire extends SpeedingFixWire {
  /** ACCEL / DECEL: impossible speed change; TRACK: positions show it far slower. */
  reason: 'ACCEL' | 'DECEL' | 'TRACK';
  /** Speed the positions show around the fix; null when too few to tell. */
  trackKmh: number | null;
}

export interface SpeedingAlarmWire {
  id: string;
  raisedAt: string;
  severity: string;
  status: string;
  speedKmh: number | null;
  message: string;
}

export interface SpeedingEpisodeWire {
  startedAt: string;
  endedAt: string;
  durationSec: number;
  fixCount: number;
  maxSpeedKmh: number;
  avgSpeedKmh: number;
  overLimitKmh: number;
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
  peak: { at: string; lat: number; lng: number };
  driver: string | null;
  alarms: SpeedingAlarmWire[];
  fixes: SpeedingFixWire[];
}

export interface SpeedingEventsResponse {
  vehicleId: string;
  label: string;
  limitKmh: number;
  from: string;
  to: string;
  summary: {
    episodeCount: number;
    overLimitFixCount: number;
    maxSpeedKmh: number | null;
    totalDurationSec: number;
    /** Fastest plausible fix of ALL stored fixes in the window — null when none. */
    maxReportedKmh: number | null;
    positionCount: number;
    alarmCount: number;
    /** Over-limit fixes set aside as GPS errors (not counted above). */
    discardedFixCount: number;
  };
  episodes: SpeedingEpisodeWire[];
  /** Over-limit fixes the surrounding telemetry contradicts, with the reason. */
  discarded: SpeedingDiscardedFixWire[];
  truncated: boolean;
}

/** Per-episode speeding evidence of ONE vehicle, built from stored GPS fixes. */
export function useSpeedingEvents(range: ReportRange, vehicleId: string, limitKmh: number) {
  return useQuery({
    queryKey: ['reports', 'speeding-events', range, vehicleId, limitKmh],
    enabled: vehicleId !== '',
    queryFn: () =>
      apiGetRaw<SpeedingEventsResponse>(
        '/reports/speeding-events',
        rangeParams(range, { vehicleId, limitKmh }),
      ),
  });
}

export function useIdleParking(
  range: ReportRange,
  filters: { vehicleId?: string; kind?: 'IDLE' | 'PARKING' } = {},
) {
  return useQuery({
    queryKey: ['reports', 'idle-parking', range, filters],
    queryFn: () =>
      apiGetRaw<{
        items: PeriodRowWire[];
        nextCursor: string | null;
        summary?: PlannedStopSummaryWire;
      }>('/reports/idle-parking', rangeParams(range, { ...filters, limit: 50 })),
  });
}

export function useVehicleMeters(
  range: ReportRange,
  filters: { vehicleId?: string; fleetId?: string } = {},
) {
  return useQuery({
    queryKey: ['reports', 'vehicle-meters', range, filters],
    queryFn: () =>
      apiGetRaw<{ items: VehicleMetersRowWire[]; total: number }>(
        '/reports/vehicle-meters',
        rangeParams(range, { ...filters, limit: 50 }),
      ),
  });
}

export function useAlarmReport(
  range: ReportRange,
  filters: { vehicleId?: string; type?: string; severity?: string } = {},
) {
  return useQuery({
    queryKey: ['reports', 'alarms', range, filters],
    queryFn: () =>
      apiGetRaw<{ items: AlarmAggRowWire[]; total: number; summary: AlarmSummaryWire }>(
        '/reports/alarms',
        rangeParams(range, filters),
      ),
  });
}

export function useGeofenceReport(
  range: ReportRange,
  filters: { vehicleId?: string; geofenceId?: string } = {},
) {
  return useQuery({
    queryKey: ['reports', 'geofences', range, filters],
    queryFn: () =>
      apiGetRaw<{ items: GeofenceReportRowWire[]; total: number }>(
        '/reports/geofences',
        rangeParams(range, filters),
      ),
  });
}

export function useActivity(range: ReportRange, filters: { vehicleId?: string } = {}) {
  return useQuery({
    queryKey: ['reports', 'activity', range, filters],
    queryFn: () =>
      apiGetRaw<{ items: ActivityEventWire[]; nextCursor: string | null }>(
        '/reports/activity',
        rangeParams(range, { ...filters, limit: 50 }),
      ),
  });
}

export interface KpiIndicatorWire {
  key: string;
  value: number | null;
  previousValue: number | null;
  deltaPct: number | null;
  unit: 'count' | 'km' | 'pct' | 'kmh' | 'hours';
}

export interface KpiScorecardResponse {
  current: { indicators: KpiIndicatorWire[] };
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  dataAsOf: string;
  freshness: 'AGGREGATED';
}

export interface FleetComparisonRowWire {
  fleetId: string | null;
  fleetName: string;
  vehicleCount: number;
  distanceKm: number;
  trips: number;
  movingDurationSec: number;
  utilizationPct: number | null;
  alarms: number;
}

export interface SafetyScorecardResponse {
  current: {
    totalAlarms: number;
    openAlarms: number;
    speedingEvents: number;
    highSeverityAlarms: number;
    geofenceEvents: number;
    previous: {
      totalAlarms: number;
      openAlarms: number;
      speedingEvents: number;
      highSeverityAlarms: number;
      geofenceEvents: number;
    };
  };
  from: string;
  to: string;
  dataAsOf: string;
  freshness: 'AGGREGATED';
}

export function useKpiScorecard(range: ReportRange) {
  return useQuery({
    queryKey: ['reports', 'kpis', range],
    queryFn: () => apiGetRaw<KpiScorecardResponse>('/reports/kpis', rangeParams(range)),
  });
}

export function useFleetComparison(range: ReportRange) {
  return useQuery({
    queryKey: ['reports', 'fleet-comparison', range],
    queryFn: () =>
      apiGetRaw<{ items: FleetComparisonRowWire[] }>(
        '/reports/fleet-comparison',
        rangeParams(range),
      ),
  });
}

export function useSafetyScorecard(range: ReportRange) {
  return useQuery({
    queryKey: ['reports', 'safety', range],
    queryFn: () => apiGetRaw<SafetyScorecardResponse>('/reports/safety', rangeParams(range)),
  });
}

/** CSV export (§31): authenticated blob download from the reporting service. */
export async function exportReportCsv(
  report: 'trips' | 'vehicle-utilization' | 'alarms' | 'speeding-events',
  range: ReportRange,
  filters: Record<string, unknown> = {},
): Promise<void> {
  const blob = await apiGetBlob(`/reports/export/${report}`, rangeParams(range, filters));
  downloadBlob(blob, `${report}-${new Date().toISOString().slice(0, 10)}.csv`);
}

// ── Fleet-wide tabular reports (high speeds, mileage, temperature) ───────────

/** Vehicle / fleet scope shared by the fleet-wide reports. */
export interface FleetScope {
  vehicleId?: string;
  fleetId?: string;
}

export interface OverspeedRowWire {
  vehicleId: string;
  label: string;
  fleetName: string | null;
  seq: number;
  startedAt: string;
  endedAt: string;
  durationSec: number;
  maxSpeedKmh: number;
  avgSpeedKmh: number;
  fixCount: number;
  peak: { at: string; lat: number; lng: number };
}

export interface OverspeedReportResponse {
  from: string;
  to: string;
  limitKmh: number;
  minDurationSec: number;
  truncated: boolean;
  summary: {
    episodeCount: number;
    vehicleCount: number;
    maxSpeedKmh: number | null;
    totalDurationSec: number;
    discardedFixCount: number;
  };
  items: OverspeedRowWire[];
}

export interface MileageRowWire {
  vehicleId: string;
  label: string;
  fleetId: string | null;
  fleetName: string | null;
  distanceKm: number;
  trips: number;
}

export interface MileageReportResponse {
  from: string;
  to: string;
  hideZero: boolean;
  groups: Array<{
    fleetId: string | null;
    fleetName: string | null;
    rows: MileageRowWire[];
    subtotalKm: number;
    vehicleCount: number;
  }>;
  totalKm: number;
  vehicleCount: number;
  hiddenZeroCount: number;
}

export interface TemperatureRowWire {
  vehicleId: string;
  label: string;
  fleetName: string | null;
  sensor: string;
  seq: number;
  kind: 'HIGH' | 'LOW';
  startedAt: string;
  endedAt: string;
  durationSec: number;
  minC: number;
  maxC: number;
  avgC: number;
  readings: number;
  start: { lat: number; lng: number };
}

export interface TemperatureReportResponse {
  from: string;
  to: string;
  minC: number | null;
  maxC: number | null;
  minDurationSec: number;
  truncated: boolean;
  summary: {
    episodeCount: number;
    vehicleCount: number;
    vehiclesWithSensors: number;
    totalDurationSec: number;
    highestC: number | null;
    lowestC: number | null;
  };
  sensors: Array<{
    vehicleId: string;
    label: string;
    sensor: string;
    readings: number;
    minC: number;
    maxC: number;
  }>;
  items: TemperatureRowWire[];
}

function scopeParams(scope: FleetScope) {
  return {
    ...(scope.vehicleId ? { vehicleId: scope.vehicleId } : {}),
    ...(scope.fleetId ? { fleetId: scope.fleetId } : {}),
  };
}

export function useOverspeedReport(
  range: ReportRange,
  scope: FleetScope,
  opts: { limitKmh: number; minDurationSec: number },
) {
  return useQuery({
    queryKey: ['reports', 'overspeed', range, scope, opts],
    queryFn: () =>
      apiGetRaw<OverspeedReportResponse>(
        '/reports/overspeed',
        rangeParams(range, { ...scopeParams(scope), ...opts }),
      ),
  });
}

export function useMileageReport(range: ReportRange, scope: FleetScope, hideZero: boolean) {
  return useQuery({
    queryKey: ['reports', 'mileage', range, scope, hideZero],
    queryFn: () =>
      apiGetRaw<MileageReportResponse>(
        '/reports/mileage',
        rangeParams(range, { ...scopeParams(scope), hideZero }),
      ),
  });
}

export function useTemperatureReport(
  range: ReportRange,
  scope: FleetScope,
  opts: { minC: number | null; maxC: number | null; minDurationSec: number },
) {
  return useQuery({
    queryKey: ['reports', 'temperature', range, scope, opts],
    enabled: opts.minC !== null || opts.maxC !== null,
    queryFn: () =>
      apiGetRaw<TemperatureReportResponse>(
        '/reports/temperature',
        rangeParams(range, {
          ...scopeParams(scope),
          ...(opts.minC !== null ? { minC: opts.minC } : {}),
          ...(opts.maxC !== null ? { maxC: opts.maxC } : {}),
          minDurationSec: opts.minDurationSec,
        }),
      ),
  });
}

/** Excel download of a fleet-wide report (Shamsi dates; Persian or English headers). */
export async function exportFleetWorkbook(
  report: 'overspeed' | 'mileage' | 'temperature' | 'objects',
  range: ReportRange,
  params: Record<string, unknown>,
  lang: 'fa' | 'en',
): Promise<void> {
  const blob = await apiGetBlob(
    `/reports/workbook/${report}`,
    rangeParams(range, { ...params, lang }),
  );
  downloadBlob(blob, `${report}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ── Objects (live fleet status, legacy objects list) ─────────────────────────

export interface ObjectStatusRowWire {
  vehicleId: string;
  name: string;
  imei: string | null;
  plate: string | null;
  fleetName: string | null;
  model: string | null;
  vin: string | null;
  simNumber: string | null;
  active: boolean;
  lat: number | null;
  lng: number | null;
  speedKmh: number | null;
  altitudeM: number | null;
  headingDeg: number | null;
  odometerKm: number | null;
  engineHours: number | null;
  lastFixAt: string | null;
  lastReceivedAt: string | null;
  connection: string | null;
}

export interface ObjectsReportResponse {
  asOf: string;
  summary: { total: number; online: number; moving: number; noFix: number; silent24h: number };
  items: ObjectStatusRowWire[];
}

export function useObjectsReport(scope: FleetScope) {
  return useQuery({
    queryKey: ['reports', 'objects', scope],
    queryFn: () => apiGetRaw<ObjectsReportResponse>('/reports/objects', scopeParams(scope)),
    refetchInterval: 60_000,
  });
}

/** The objects list as CSV in the previous system's column order. */
export async function exportObjectsCsv(scope: FleetScope, lang: 'fa' | 'en'): Promise<void> {
  const blob = await apiGetBlob('/reports/objects/csv', { ...scopeParams(scope), lang });
  downloadBlob(blob, `objects_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '_')}.csv`);
}
