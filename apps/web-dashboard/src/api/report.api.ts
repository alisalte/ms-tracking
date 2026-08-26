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

export function useIdleParking(
  range: ReportRange,
  filters: { vehicleId?: string; kind?: 'IDLE' | 'PARKING' } = {},
) {
  return useQuery({
    queryKey: ['reports', 'idle-parking', range, filters],
    queryFn: () =>
      apiGetRaw<{ items: PeriodRowWire[]; nextCursor: string | null }>(
        '/reports/idle-parking',
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
      apiGetRaw<{ items: FleetComparisonRowWire[] }>('/reports/fleet-comparison', rangeParams(range)),
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
  report: 'trips' | 'vehicle-utilization' | 'alarms',
  range: ReportRange,
  filters: Record<string, unknown> = {},
): Promise<void> {
  const blob = await apiGetBlob(`/reports/export/${report}`, rangeParams(range, filters));
  downloadBlob(blob, `${report}-${new Date().toISOString().slice(0, 10)}.csv`);
}
