/**
 * Spatial analytics API — GPS coverage heatmap + movement patterns.
 *
 * Sources (all RAW — no { data } envelope):
 *   gps-engine          GET /positions/analytics/gps-coverage — per-cell GPS quality
 *   gps-engine          GET /positions/analytics/movement     — activity cells, project
 *                                                               area, weekday×hour, vehicles
 *   notification-service GET /notification/alerts            — GPS-loss alarms (paged)
 *
 * The GPS-loss alarms (GPS_SIGNAL_LOST / GPS_ANTENNA_CUT / JAMMING) carry the
 * last known position, so they are merged into the coverage grid client-side:
 * each alarm lowers the score of the cell it fell in.
 */
import { useQuery } from '@tanstack/react-query';

import { mapAlarm } from '@/api/alarm.api';
import type { Alarm } from '@/types/alarm.types';
import { apiGetRaw } from './client';

export type AnalyticsPreset = '24h' | '7d' | '30d';

export const ANALYTICS_PRESETS: readonly AnalyticsPreset[] = ['24h', '7d', '30d'];

const PRESET_MS: Record<AnalyticsPreset, number> = {
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

export type CoverageLevel = 'good' | 'fair' | 'poor' | 'none';

interface CellBounds {
  south: number;
  west: number;
  north: number;
  east: number;
  /** Cell centre. */
  lat: number;
  lng: number;
}

export interface CoverageCell extends CellBounds {
  points: number;
  satPoints: number;
  avgSatellites: number | null;
  weakPoints: number;
  noFixPoints: number;
  lowQualityPoints: number;
  gaps: number;
  vehicles: number;
  score: number;
  level: CoverageLevel;
  /** GPS-loss alarms that fell in this cell (merged client-side). */
  lossAlarms?: number;
  /** Lowest score any single vehicle had here — busy clean traffic must not mask it. */
  worstVehicleScore?: number | null;
}

export interface GpsCoverageResponse {
  from: string;
  to: string;
  cellMeters: number;
  totals: {
    points: number;
    weakPoints: number;
    noFixPoints: number;
    lowQualityPoints: number;
    gaps: number;
    good: number;
    fair: number;
    poor: number;
    none: number;
  };
  cells: CoverageCell[];
}

export interface MovementCell extends CellBounds {
  points: number;
  movingSec: number;
  stoppedSec: number;
  vehicles: number;
  avgMovingKph: number | null;
  maxKph: number;
}

export interface MovementResponse {
  from: string;
  to: string;
  cellMeters: number;
  timeZone: string;
  area: {
    hull: Array<{ lng: number; lat: number }>;
    areaKm2: number;
    bbox: { south: number; west: number; north: number; east: number } | null;
    coverage: number;
    cellCount: number;
  };
  cells: MovementCell[];
  hours: Array<{
    dow: number;
    hour: number;
    movingSec: number;
    stoppedSec: number;
    vehicles: number;
  }>;
  stopHotspots: MovementCell[];
  vehicles: Array<{
    vehicleId: string;
    points: number;
    distanceKm: number;
    movingSec: number;
    stoppedSec: number;
    maxKph: number;
    avgMovingKph: number | null;
    activeDays: number;
    cells: number;
    firstSeen: string;
    lastSeen: string;
  }>;
}

export interface AnalyticsFilters {
  preset: AnalyticsPreset;
  vehicleId?: string;
  /** Grid cell size in metres (server clamps to 50..5000). */
  cell: number;
}

function params(f: AnalyticsFilters) {
  return {
    preset: f.preset,
    cell: f.cell,
    ...(f.vehicleId ? { vehicleId: f.vehicleId } : {}),
  };
}

/** Alarm codes that mean "the tracker could not see the satellites". */
export const GPS_LOSS_CODES = new Set(['GPS_SIGNAL_LOST', 'GPS_ANTENNA_CUT', 'JAMMING']);

export function isGpsLossAlarm(a: Pick<Alarm, 'code' | 'type'>): boolean {
  return (a.code ? GPS_LOSS_CODES.has(a.code) : false) || a.type === 'jamming';
}

/** Page through the alert list for the window and keep the GPS-loss alarms. */
async function fetchGpsLossAlarms(f: AnalyticsFilters): Promise<Alarm[]> {
  const to = new Date();
  const from = new Date(to.getTime() - PRESET_MS[f.preset]);
  const out: Alarm[] = [];
  let cursor: string | undefined;
  // Bounded: at most 10 pages (1,000 alarms) per window.
  for (let page = 0; page < 10; page++) {
    const res = await apiGetRaw<{ data: Record<string, unknown>[]; nextCursor?: string | null }>(
      '/notification/alerts',
      {
        limit: 100,
        from: from.toISOString(),
        to: to.toISOString(),
        ...(f.vehicleId ? { vehicleId: f.vehicleId } : {}),
        ...(cursor ? { cursor } : {}),
      },
    );
    for (const raw of res.data ?? []) {
      const alarm = mapAlarm(raw);
      if (isGpsLossAlarm(alarm) && (alarm.lat !== 0 || alarm.lng !== 0)) out.push(alarm);
    }
    cursor = res.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return out;
}

export function useGpsCoverage(f: AnalyticsFilters) {
  return useQuery({
    queryKey: ['analytics', 'gps-coverage', f.preset, f.vehicleId ?? null, f.cell],
    queryFn: () => apiGetRaw<GpsCoverageResponse>('/positions/analytics/gps-coverage', params(f)),
    staleTime: 5 * 60_000,
  });
}

export function useGpsLossAlarms(f: AnalyticsFilters) {
  return useQuery({
    queryKey: ['analytics', 'gps-loss-alarms', f.preset, f.vehicleId ?? null],
    queryFn: () => fetchGpsLossAlarms(f),
    staleTime: 5 * 60_000,
  });
}

export function useMovementPatterns(f: AnalyticsFilters) {
  return useQuery({
    queryKey: ['analytics', 'movement', f.preset, f.vehicleId ?? null, f.cell],
    queryFn: () =>
      apiGetRaw<MovementResponse>('/positions/analytics/movement', {
        ...params(f),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tehran',
      }),
    staleTime: 5 * 60_000,
  });
}
