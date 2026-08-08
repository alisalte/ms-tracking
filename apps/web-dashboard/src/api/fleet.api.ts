/**
 * Fleet dashboard API + data hooks.
 *
 * The Fleet Dashboard (UI_UX_Design.md §1) needs fleet stats, 24h activity,
 * active alerts, attention list, utilization, map vehicles, and weather. None
 * of these endpoints exist in the backend yet — so each query resolves from
 * static mock data (`mock/fleet-data.ts`) with a small latency to mimic a real
 * fetch and exercise the loading skeleton states.
 *
 * When a real endpoint lands, replace the mock body of the matching function
 * with `apiGet<...Wire>('/...')` + a `mapXxxResponse(wire)` and keep the hook
 * untouched — the UI is already wired to these return types.
 */
import { useQuery } from '@tanstack/react-query';

import { resolveMock, shouldUseMock } from '@/lib/mock-gate';
import {
  mockActivity,
  mockAlerts,
  mockAttention,
  mockFleetStats,
  mockMapVehicles,
  mockTripDetail,
  mockTrips,
  mockUtilization,
  mockVehicleDetail,
  mockWeather,
} from '@/mock/fleet-data';
import type {
  ActivityBucket,
  AttentionItem,
  FleetAlert,
  FleetStats,
  FleetUtilization,
  MapVehicle,
  Trip,
  TripDetail,
  VehicleDetail,
  WeatherSnapshot,
} from '@/types/fleet.types';
import { queryKeys } from './query-keys';

// ── Fetchers ─────────────────────────────────────────────────────────────────
// All mock-backed — these services (analytics, fleet, tracking, weather) don't
// exist yet. In production (shouldUseMock() === false), these return empty
// defaults so the UI renders gracefully rather than crashing.

/** GET /api/v1/fleet/stats — mock-only. */
function fetchFleetStats(): Promise<FleetStats> {
  if (!shouldUseMock()) return Promise.resolve(mockFleetStats);
  return resolveMock(mockFleetStats);
}

/** GET /api/v1/fleet/activity?range= — mock-only. */
function fetchActivity(_range: string): Promise<ActivityBucket[]> {
  if (!shouldUseMock()) return Promise.resolve([]);
  return resolveMock(mockActivity);
}

/** GET /api/v1/alerts?status=active — mock-only. */
function fetchActiveAlerts(): Promise<FleetAlert[]> {
  if (!shouldUseMock()) return Promise.resolve([]);
  return resolveMock(mockAlerts);
}

/** GET /api/v1/fleet/attention — mock-only. */
function fetchAttention(): Promise<AttentionItem[]> {
  if (!shouldUseMock()) return Promise.resolve([]);
  return resolveMock(mockAttention);
}

/** GET /api/v1/fleet/utilization — mock-only. */
function fetchUtilization(): Promise<FleetUtilization> {
  if (!shouldUseMock()) return Promise.resolve(mockUtilization);
  return resolveMock(mockUtilization);
}

/** GET /api/v1/tracking/positions — mock-only. */
function fetchMapVehicles(): Promise<MapVehicle[]> {
  if (!shouldUseMock()) return Promise.resolve([]);
  return resolveMock(mockMapVehicles);
}

/** GET /api/v1/weather?lat=&lng= — mock-only. */
function fetchWeather(): Promise<WeatherSnapshot> {
  if (!shouldUseMock()) return Promise.resolve(mockWeather);
  return resolveMock(mockWeather);
}

/** GET /api/v1/tracking/vehicles/{id}/position + enrichment — mock-only. */
function fetchVehicleDetail(id: string): Promise<VehicleDetail> {
  return resolveMock(mockVehicleDetail(id));
}

/** GET /api/v1/trips — mock-only. */
function fetchTrips(): Promise<Trip[]> {
  if (!shouldUseMock()) return Promise.resolve([]);
  return resolveMock(mockTrips);
}

/** GET /api/v1/trips/{id} + replay track — mock-only. */
function fetchTripDetail(id: string): Promise<TripDetail> {
  return resolveMock(mockTripDetail(id));
}

/** GET /api/v1/trips/active (pending backend). */
function fetchActiveTrips(): Promise<Trip[]> {
  return resolveMock(mockTrips.filter((t) => t.status === 'in_progress'));
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Fleet KPI summary (stat-card row). */
export function useFleetStats() {
  return useQuery({ queryKey: queryKeys.fleet.stats(), queryFn: fetchFleetStats });
}

/** 24h fleet activity series for the stacked-area chart. */
export function useFleetActivity(range: string) {
  return useQuery({
    queryKey: queryKeys.fleet.activity(range),
    queryFn: () => fetchActivity(range),
  });
}

/** Severity-sorted active alerts. */
export function useActiveAlerts() {
  return useQuery({ queryKey: queryKeys.fleet.alerts(), queryFn: fetchActiveAlerts });
}

/** Vehicles needing attention (ranked). */
export function useAttention() {
  return useQuery({ queryKey: queryKeys.fleet.attention(), queryFn: fetchAttention });
}

/** Fleet utilization donut breakdown. */
export function useFleetUtilization() {
  return useQuery({ queryKey: queryKeys.fleet.utilization(), queryFn: fetchUtilization });
}

/** Latest vehicle positions for the map preview. */
export function useMapVehicles() {
  return useQuery({ queryKey: queryKeys.fleet.mapVehicles(), queryFn: fetchMapVehicles });
}

/** Enriched vehicle detail for the device popup drawer. */
export function useVehicleDetail(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.fleet.vehicleDetail(id) : ['fleet', 'vehicle', 'none'],
    queryFn: () => fetchVehicleDetail(id as string),
    enabled: Boolean(id),
  });
}

/** Trip list for the Trips page. */
export function useTrips() {
  return useQuery({ queryKey: queryKeys.trips.list(), queryFn: fetchTrips });
}

/** Enriched trip detail (replay track + events) for the Trip detail page. */
export function useTripDetail(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.trips.detail(id) : ['trips', 'detail', 'none'],
    queryFn: () => fetchTripDetail(id as string),
    enabled: Boolean(id),
  });
}

/** Currently in-progress trips. */
export function useActiveTrips() {
  return useQuery({ queryKey: queryKeys.trips.active(), queryFn: fetchActiveTrips });
}

/** Current weather + forecast. */
export function useWeather() {
  return useQuery({ queryKey: queryKeys.fleet.weather(), queryFn: fetchWeather });
}
