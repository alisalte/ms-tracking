/**
 * Map-engine + historical-track API (Sprint F).
 *
 * Sources (all RAW — no { data } envelope):
 *   gps-engine  GET /positions/:vehicleId?from=&to=&limit= — historical track
 *   map-engine  GET /location/reverse?lat=&lng=            — reverse geocode
 *   map-engine  GET /location/geocode?q=                   — forward geocode
 *   map-engine  GET /route?waypoints=&mode=                — real routing (OSRM-backed)
 *
 * Sprint F §13: reverse geocoding is ONLY performed for justified events — the
 * selected vehicle's drawer or an explicit user action — never per telemetry
 * update (the backend caches by rounded coordinate in Redis anyway).
 */
import { useQuery } from '@tanstack/react-query';

import { apiGetRaw } from './client';

/** One point of a historical track (gps-engine LatestPosition wire). */
export interface TrackPoint {
  readonly vehicleId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly speedKph: number;
  readonly headingDeg: number;
  readonly capturedAt: string;
}

/** A reverse-geocoded address (map-engine Address wire). */
export interface GeocodedAddress {
  readonly latitude: number;
  readonly longitude: number;
  readonly formatted: string;
  readonly components: Record<string, string>;
  readonly provider: string;
}

/** A provider-backed route (map-engine RouteResult wire). */
export interface RouteResult {
  readonly distanceKm: number;
  readonly durationSec: number;
  readonly geometry: ReadonlyArray<{ lat: number; lng: number }>;
  readonly mode: 'static' | 'live' | 'optimized';
  readonly provider: string;
}

/** Time-window presets for history mode (Sprint F §20/§21 — bounded ranges). */
export const HISTORY_PRESETS = [
  { id: '1h', hours: 1 },
  { id: '6h', hours: 6 },
  { id: '24h', hours: 24 },
  { id: '7d', hours: 24 * 7 },
] as const;

export type HistoryPresetId = (typeof HISTORY_PRESETS)[number]['id'];

/** Resolve a preset to an explicit [from, to] ISO window (UTC). */
export function presetRange(
  preset: HistoryPresetId,
  now = new Date(),
): { from: string; to: string } {
  const hours = HISTORY_PRESETS.find((p) => p.id === preset)?.hours ?? 24;
  return {
    from: new Date(now.getTime() - hours * 3_600_000).toISOString(),
    to: now.toISOString(),
  };
}

/** GET /positions/:vehicleId — the historical track for a time window. */
export function fetchVehicleTrack(
  vehicleId: string,
  from: string,
  to: string,
): Promise<TrackPoint[]> {
  return apiGetRaw<TrackPoint[]>(`/positions/${vehicleId}`, { from, to, limit: 10_000 });
}

/** Historical track query (enabled only in history mode with a selection). */
export function useVehicleTrack(
  vehicleId: string | null,
  from: string,
  to: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['map', 'track', vehicleId, from, to],
    queryFn: () => fetchVehicleTrack(vehicleId as string, from, to),
    enabled: enabled && Boolean(vehicleId),
    // Tracks are immutable history — safe to cache the window aggressively.
    staleTime: 60_000,
  });
}

/** GET /location/reverse — reverse geocode a coordinate (justified events only). */
export function useReverseGeocode(lat: number | null, lng: number | null) {
  return useQuery({
    queryKey: ['map', 'reverse', lat?.toFixed(5), lng?.toFixed(5)],
    queryFn: () => apiGetRaw<GeocodedAddress | null>('/location/reverse', { lat, lng }),
    enabled: lat !== null && lng !== null,
    staleTime: 10 * 60_000, // addresses rarely change
    retry: false, // provider 503s must not hammer the map-engine
  });
}

/** GET /location/geocode — forward geocode (route planner origin/destination). */
export function fetchGeocode(query: string): Promise<GeocodedAddress[]> {
  return apiGetRaw<GeocodedAddress[]>('/location/geocode', { q: query });
}

/** GET /route — real provider-backed routing (503 when no provider configured). */
export function fetchRoute(
  waypoints: ReadonlyArray<{ lat: number; lng: number }>,
  mode: 'static' | 'live' | 'optimized' = 'static',
): Promise<RouteResult> {
  const wp = waypoints.map((w) => `${w.lat},${w.lng}`).join(';');
  return apiGetRaw<RouteResult>('/route', { waypoints: wp, mode });
}
