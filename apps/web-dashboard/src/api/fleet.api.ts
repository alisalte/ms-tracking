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

import { queryKeys } from './query-keys';
import {
  mockActivity,
  mockAlerts,
  mockAttention,
  mockFleetStats,
  mockMapVehicles,
  mockTripDetail,
  mockTrips,
  mockVehicleDetail,
  mockUtilization,
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

/** Simulated network latency so loading skeletons are visible during dev. */
const MOCK_LATENCY_MS = 250;

/** Resolve mock data after a short delay. */
function resolveMock<T>(data: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(data), MOCK_LATENCY_MS));
}

// ── Fetchers (swap mock → apiGet when backends land) ─────────────────────────

/** GET /api/v1/fleet/stats (pending backend). */
function fetchFleetStats(): Promise<FleetStats> {
  return resolveMock(mockFleetStats);
}

/** GET /api/v1/fleet/activity?range= (pending backend). */
function fetchActivity(_range: string): Promise<ActivityBucket[]> {
  return resolveMock(mockActivity);
}

/** GET /api/v1/alerts?status=active (pending backend). */
function fetchActiveAlerts(): Promise<FleetAlert[]> {
  return resolveMock(mockAlerts);
}

/** GET /api/v1/fleet/attention (pending backend). */
function fetchAttention(): Promise<AttentionItem[]> {
  return resolveMock(mockAttention);
}

/** GET /api/v1/fleet/utilization (pending backend). */
function fetchUtilization(): Promise<FleetUtilization> {
  return resolveMock(mockUtilization);
}

/** GET /api/v1/tracking/positions (pending backend). */
function fetchMapVehicles(): Promise<MapVehicle[]> {
  return resolveMock(mockMapVehicles);
}

/** GET /api/v1/weather?lat=&lng= (pending backend). */
function fetchWeather(): Promise<WeatherSnapshot> {
  return resolveMock(mockWeather);
}

/** GET /api/v1/tracking/vehicles/{id}/position + enrichment (pending backend). */
function fetchVehicleDetail(id: string): Promise<VehicleDetail> {
  return resolveMock(mockVehicleDetail(id));
}

/** GET /api/v1/trips (pending backend). */
function fetchTrips(): Promise<Trip[]> {
  return resolveMock(mockTrips);
}

/** GET /api/v1/trips/{id} + replay track (pending backend). */
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
  return useQuery({ queryKey: queryKeys.fleet.activity(range), queryFn: () => fetchActivity(range) });
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
