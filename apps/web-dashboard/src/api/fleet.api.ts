/**
 * Fleet dashboard API + data hooks — REAL backend (Sprint E).
 *
 * Sources:
 *   - fleet-management GET /summary            → registry counts (stat cards)
 *   - fleet-management GET /vehicles (paged)   → the vehicle registry
 *   - gps-engine      GET /tracking/devices/status → connection state (ONLINE/OFFLINE/STALE)
 *   - gps-engine      GET /positions/latest    → latest position per vehicle (map bootstrap)
 *   - gps-engine      GET /positions/:id/latest→ single-vehicle detail
 *   - fleet-mgmt      GET /vehicles/:id/devices→ bound devices for the detail drawer
 *
 * Mock mode (`?useMock=true`, dev/demo only): the deterministic fixture
 * dataset stands in so the UI stays demoable offline. Production is real-only
 * — no unconditional mock returns remain (Sprint E §31).
 *
 * Wire notes:
 *   - fleet-management wraps payloads in { data } (apiGet unwraps).
 *   - gps-engine REST responds RAW (no envelope) — hence apiGetRaw.
 *   - `latest` position `vehicleId` may carry the deviceId when a device is
 *     UNBOUND (gps-engine fallback); bound devices carry the registry vehicleId.
 */
import { useQuery } from '@tanstack/react-query';

import { resolveMock, shouldUseMock, withMockFallback } from '@/lib/mock-gate';
import { mockMapVehicles, mockTripDetail, mockTrips } from '@/mock/fleet-data';
import type { Alarm } from '@/types/alarm.types';
import type { BoundDevice, FleetSummary } from '@/types/asset.types';
import type {
  DeviceConnection,
  FleetAlert,
  FleetStats,
  LatestPosition,
  MapVehicle,
  Trip,
  TripDetail,
  VehicleDetail,
  VehiclePresence,
} from '@/types/fleet.types';
import { fetchAllVehiclesAsMap } from './asset.api';
import { apiGet, apiGetRaw } from './client';
import { queryKeys } from './query-keys';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Derive the UI movement state from a position + connection state (§18). */
function movementState(
  pos: LatestPosition | undefined,
  presence: VehiclePresence,
): MapVehicle['state'] {
  if (presence === 'OFFLINE' || presence === 'UNKNOWN') return 'offline';
  if (presence === 'STALE') return 'stopped';
  if (!pos) return 'stopped';
  if (pos.speedKph > 2) return 'driving';
  return pos.ignitionOn === false ? 'stopped' : 'idle';
}

/** Build a map vehicle row from the real backend triple (registry + status + position). */
function toMapVehicle(
  vehicle: { id: string; name: string; code: string; plate: string | null },
  presence: VehiclePresence,
  pos: LatestPosition | undefined,
  deviceId: string | undefined,
  lastSeenAt: string | undefined,
): MapVehicle {
  return {
    id: vehicle.id,
    label: vehicle.plate ?? `${vehicle.name} (${vehicle.code})`,
    state: movementState(pos, presence),
    lat: pos?.latitude ?? 0,
    lng: pos?.longitude ?? 0,
    heading: pos?.headingDeg ?? 0,
    speed: pos?.speedKph ?? 0,
    ignitionOn: pos?.ignitionOn ?? undefined,
    updatedAt: pos?.capturedAt,
    deviceId,
    presence,
    lastSeenAt,
  };
}

// ── Fetchers ─────────────────────────────────────────────────────────────────

/** GET /tracking/devices/status — connection state for every tenant device. */
export function fetchDeviceStatuses(): Promise<DeviceConnection[]> {
  return withMockFallback(
    () => apiGetRaw<DeviceConnection[]>('/tracking/devices/status'),
    () => resolveMock([]),
  );
}

/** GET /positions/latest — latest position per vehicle (one request, no N+1). */
export function fetchLatestPositions(): Promise<LatestPosition[]> {
  return withMockFallback(
    () => apiGetRaw<LatestPosition[]>('/positions/latest'),
    () => resolveMock([]),
  );
}

/** GET /summary + /tracking/devices/status → the stat-card row (§21). */
function fetchFleetStats(): Promise<FleetStats> {
  if (shouldUseMock()) {
    // Dev/demo fixture: derive the old-style counts from the map fixture.
    const fleet = mockMapVehicles;
    const online = fleet.filter((v) => v.state !== 'offline').length;
    return resolveMock({
      totalVehicles: fleet.length,
      online,
      offline: fleet.length - online,
      stale: 0,
      unknown: 0,
      totalFleets: 0,
      totalDevices: 0,
    });
  }
  return withMockFallback(
    async () => {
      const [summary, statuses] = await Promise.all([
        apiGet<FleetSummary>('/summary'),
        fetchDeviceStatuses(),
      ]);
      const online = statuses.filter((s) => s.state === 'ONLINE').length;
      const offline = statuses.filter((s) => s.state === 'OFFLINE').length;
      const stale = statuses.filter((s) => s.state === 'STALE').length;
      // Vehicles without any device status record are UNKNOWN (never guessed).
      const unknown = Math.max(0, summary.vehicles.active - statuses.length);
      return {
        totalVehicles: summary.vehicles.active,
        online,
        offline,
        stale,
        unknown,
        totalFleets: summary.fleets.active,
        totalDevices: summary.devices.total,
      } satisfies FleetStats;
    },
    () =>
      resolveMock({
        totalVehicles: 0,
        online: 0,
        offline: 0,
        stale: 0,
        unknown: 0,
        totalFleets: 0,
        totalDevices: 0,
      }),
  );
}

/**
 * The live map's base layer: registry vehicles joined with their latest
 * positions + connection states. Live deltas then stream over the WebSocket.
 */
function fetchMapVehicles(): Promise<MapVehicle[]> {
  if (shouldUseMock()) return resolveMock(mockMapVehicles);
  return withMockFallback(
    async () => {
      const { vehicles, devices } = await fetchAllVehiclesAsMap();
      const [statuses, positions] = await Promise.all([
        fetchDeviceStatuses(),
        fetchLatestPositions(),
      ]);
      const statusByDevice = new Map(statuses.map((s) => [s.deviceId, s]));
      const vehicleToDevice = new Map<string, { deviceId: string; lastSeenAt?: string }>();
      for (const d of devices) {
        if (d.vehicleId) {
          const status = statusByDevice.get(d.id);
          vehicleToDevice.set(d.vehicleId, { deviceId: d.id, lastSeenAt: status?.lastSeenAt });
        }
      }
      const posByVehicle = new Map(positions.map((p) => [p.vehicleId, p]));
      return vehicles.map((v) => {
        const bound = vehicleToDevice.get(v.id);
        const status = bound ? statusByDevice.get(bound.deviceId) : undefined;
        const presence: VehiclePresence = status?.state ?? 'UNKNOWN';
        // Positions of unbound devices are keyed by deviceId (gps-engine fallback).
        const pos =
          posByVehicle.get(v.id) ?? (bound ? posByVehicle.get(bound.deviceId) : undefined);
        return toMapVehicle(v, presence, pos, bound?.deviceId, status?.lastSeenAt);
      });
    },
    () => resolveMock([]),
  );
}

/**
 * Enriched vehicle detail (§10/§19): registry record + bound devices + the
 * latest position + connection state. Real-only; throws when the backend is
 * unreachable so the drawer can show an honest error state.
 */
function fetchVehicleDetail(id: string): Promise<VehicleDetail> {
  return withMockFallback<VehicleDetail>(
    async () => {
      const [vehicleWire, devicesWire, statusList] = await Promise.all([
        apiGet<{ id: string; name: string; code: string; plate: string | null }>(`/vehicles/${id}`),
        apiGet<BoundDevice[]>(`/vehicles/${id}/devices`),
        fetchDeviceStatuses(),
      ]);
      const primary = devicesWire.find((d) => d.isPrimary) ?? devicesWire[0];
      const status = primary ? statusList.find((s) => s.deviceId === primary.deviceId) : undefined;
      let position: LatestPosition | undefined;
      try {
        position = await apiGetRaw<LatestPosition>(`/positions/${id}/latest`);
      } catch {
        // 404 when the vehicle has never reported — the drawer shows "never seen".
        position = undefined;
      }
      const presence: VehiclePresence = status?.state ?? 'UNKNOWN';
      return {
        id: vehicleWire.id,
        label: vehicleWire.plate ?? `${vehicleWire.name} (${vehicleWire.code})`,
        state: movementState(position, presence),
        lat: position?.latitude ?? 0,
        lng: position?.longitude ?? 0,
        heading: position?.headingDeg ?? 0,
        speed: position?.speedKph ?? 0,
        ignitionOn: position?.ignitionOn ?? false,
        updatedAt: position?.capturedAt ?? '',
        lastSeenAt: status?.lastSeenAt ?? position?.capturedAt ?? undefined,
        presence,
        deviceId: primary?.deviceId,
        odometer: 0, // Not exposed by the backend yet — never fabricated.
        address: '', // Reverse geocoding is a map-engine concern (out of scope).
        events: [],
      } satisfies VehicleDetail;
    },
    async (): Promise<VehicleDetail> => {
      const fixture = mockMapVehicles.find((v) => v.id === id) ?? mockMapVehicles[0];
      if (!fixture) throw new Error('mock fixture unavailable');
      return {
        ...fixture,
        odometer: 0,
        address: '',
        ignitionOn: fixture.ignitionOn ?? false,
        updatedAt: fixture.updatedAt ?? '',
        events: [],
      };
    },
  );
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Fleet KPI summary (stat-card row) — real counts, single batched fetch. */
export function useFleetStats() {
  return useQuery({ queryKey: queryKeys.fleet.stats(), queryFn: fetchFleetStats });
}

/** Connection state of every tenant device (map + dashboard). */
export function useDeviceStatuses() {
  return useQuery({ queryKey: queryKeys.fleet.deviceStatuses(), queryFn: fetchDeviceStatuses });
}

/** Latest position per vehicle (map bootstrap, NOT per-vehicle polling). */
export function useLatestPositions() {
  return useQuery({ queryKey: queryKeys.fleet.latestPositions(), queryFn: fetchLatestPositions });
}

/** The live map's base layer (registry × status × position). */
export function useMapVehicles() {
  return useQuery({ queryKey: queryKeys.fleet.mapVehicles(), queryFn: fetchMapVehicles });
}

/** Enriched vehicle detail for the map popup drawer. */
export function useVehicleDetail(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.fleet.vehicleDetail(id) : ['fleet', 'vehicle', 'none'],
    queryFn: () => fetchVehicleDetail(id as string),
    enabled: Boolean(id),
  });
}

// ── Trips (REAL gps-engine /trips — Sprint F §11) ────────────────────────────

/** gps-engine trip_events row (raw wire — camelCase, no envelope). */
interface TripWire {
  readonly id: string;
  readonly vehicleId: string;
  readonly status: 'ACTIVE' | 'COMPLETED' | 'DISCARDED';
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly startLat: number;
  readonly startLng: number;
  readonly endLat: number | null;
  readonly endLng: number | null;
  readonly distanceKm: number;
  readonly durationS: number;
  readonly maxSpeedKmh: number;
  readonly stopCount: number;
}

interface TripDetailWire extends TripWire {
  readonly avgSpeedKph: number;
  readonly waypoints: ReadonlyArray<{
    ts: string;
    lat: number;
    lng: number;
    speed: number;
    heading: number;
  }>;
  readonly events: ReadonlyArray<{
    id: string;
    type: 'idle' | 'stop';
    ts: string;
    lat: number | null;
    lng: number | null;
    durationMin: number;
  }>;
}

/** Trip status wire → UI lifecycle subset. */
function toTripStatus(wire: TripWire['status']): Trip['status'] {
  if (wire === 'ACTIVE') return 'in_progress';
  if (wire === 'DISCARDED') return 'cancelled';
  return 'completed';
}

/**
 * Trip list — REAL `GET /trips` (gps-engine trip_events projection, last 7 days
 * by default). Vehicle labels join the registry (best-effort; falls back to the
 * vehicle id). Origin/destination render as coordinates — reverse-geocoded
 * labels are a map-engine concern and are NOT fabricated here.
 */
function fetchTrips(): Promise<Trip[]> {
  if (!shouldUseMock()) {
    return (async () => {
      const now = new Date();
      const from = new Date(now.getTime() - 7 * 86_400_000).toISOString();
      const [wires, registry] = await Promise.all([
        apiGetRaw<TripWire[]>('/trips', { from, to: now.toISOString(), limit: 100 }),
        fetchAllVehiclesAsMap().catch(() => ({
          vehicles: [] as Array<{ id: string; name: string; code: string; plate: string | null }>,
        })),
      ]);
      const labelOf = new Map(registry.vehicles.map((v) => [v.id, v.plate ?? v.name ?? v.code]));
      return wires.map((w): Trip => {
        const durationH = w.durationS / 3600;
        return {
          id: w.id,
          vehicleId: w.vehicleId,
          vehicleLabel: labelOf.get(w.vehicleId) ?? w.vehicleId.slice(0, 8),
          status: toTripStatus(w.status),
          originLabel: `${w.startLat.toFixed(4)}, ${w.startLng.toFixed(4)}`,
          destinationLabel:
            w.endLat !== null && w.endLng !== null
              ? `${w.endLat.toFixed(4)}, ${w.endLng.toFixed(4)}`
              : '—',
          startTime: w.startedAt,
          endTime: w.endedAt ?? undefined,
          distanceKm: Math.round(w.distanceKm * 10) / 10,
          durationMin: Math.round(w.durationS / 60),
          maxSpeed: Math.round(w.maxSpeedKmh),
          avgSpeed: durationH > 0 ? Math.round((w.distanceKm / durationH) * 10) / 10 : 0,
          stopCount: w.stopCount,
          // Idle totals are not part of the list projection — never fabricated.
        };
      });
    })();
  }
  return resolveMock(mockTrips);
}

/**
 * Trip detail — REAL `GET /trips/:id` (trip + waypoints from the positions
 * hypertable + idle/parking events). Idle time is summed from the events;
 * events without coordinates stay on the timeline only.
 */
function fetchTripDetail(id: string): Promise<TripDetail | null> {
  if (!shouldUseMock()) {
    return (async () => {
      const w = await apiGetRaw<TripDetailWire>(`/trips/${id}`);
      const idleMin = w.events
        .filter((e) => e.type === 'idle')
        .reduce((sum, e) => sum + e.durationMin, 0);
      return {
        id: w.id,
        vehicleId: w.vehicleId,
        vehicleLabel: w.vehicleId.slice(0, 8),
        status: toTripStatus(w.status),
        originLabel: `${w.startLat.toFixed(4)}, ${w.startLng.toFixed(4)}`,
        destinationLabel:
          w.endLat !== null && w.endLng !== null
            ? `${w.endLat.toFixed(4)}, ${w.endLng.toFixed(4)}`
            : '—',
        startTime: w.startedAt,
        endTime: w.endedAt ?? undefined,
        distanceKm: Math.round(w.distanceKm * 10) / 10,
        durationMin: Math.round(w.durationS / 60),
        maxSpeed: Math.round(w.maxSpeedKmh),
        avgSpeed: w.avgSpeedKph,
        stopCount: w.stopCount,
        idleMin,
        waypoints: w.waypoints.map((p) => ({
          ts: p.ts,
          lat: p.lat,
          lng: p.lng,
          speed: p.speed,
          heading: p.heading,
        })),
        events: w.events.map((e) => ({
          id: e.id,
          ts: e.ts,
          type: e.type,
          ...(e.lat !== null && e.lng !== null ? { lat: e.lat, lng: e.lng } : {}),
          label: `${e.durationMin} min`,
          durationMin: e.durationMin,
        })),
      } satisfies TripDetail;
    })();
  }
  return resolveMock(mockTripDetail(id));
}

/** Trip list for the Trips page (empty until the backend ships a trips API). */
export function useTrips() {
  return useQuery({ queryKey: queryKeys.trips.list(), queryFn: fetchTrips });
}

/** Trip detail (replay track + events). Null in real mode until the API lands. */
export function useTripDetail(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.trips.detail(id) : ['trips', 'detail', 'none'],
    queryFn: () => fetchTripDetail(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Active alerts — REAL `/notification/alerts` (notification-service), adapted
 * to the dashboard panel's FleetAlert shape. When the service is not deployed
 * the query errors and the panel shows its error state (§22: no fake success).
 */
export function useActiveAlarms() {
  return useQuery({
    queryKey: queryKeys.fleet.alerts(),
    queryFn: async (): Promise<FleetAlert[]> => {
      const { fetchAlarms } = await import('./alarm.api');
      const alarms = await fetchAlarms();
      return alarms
        .filter((a: Alarm) => a.status === 'raised' || a.status === 'escalated')
        .map(
          (a: Alarm): FleetAlert => ({
            id: a.id,
            type: a.type === 'overspeed' || a.type === 'geofence' ? a.type : 'geofence',
            severity:
              a.severity === 'critical' ? 'critical' : a.severity === 'major' ? 'warning' : 'info',
            vehicleLabel: a.vehicleLabel || a.vehicleId,
            detail: a.message || a.detail,
            occurredAt: a.raisedAt,
          }),
        );
    },
  });
}
