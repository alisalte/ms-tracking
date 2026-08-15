/**
 * Static mock fleet data — the dashboard's single demo data source.
 *
 * Reference values are taken verbatim from `UI_UX_Design.md` §1.3 (the Fleet
 * Dashboard wireframe) so the rendered screen matches the spec. When the
 * analytics/gps backends expose real endpoints, `api/fleet.api.ts` will swap
 * these constants for `apiGet` calls + wire→camelCase mapping — the types and
 * UI stay unchanged.
 */
import type {
  ActivityBucket,
  FleetAlert,
  FleetStats,
  FleetUtilization,
  MapVehicle,
  Trip,
  TripDetail,
  TripEvent,
  TripWaypoint,
  VehiclePresence,
  VehicleType,
} from '@/types/fleet.types';

/**
 * Fleet KPI summary — the REAL Sprint E shape (§21): registry counts from
 * fleet-management + the gps-engine connection projection. The mock branch of
 * `fetchFleetStats` derives the same numbers from `mockMapVehicles` below;
 * these constants exist for tests/docs with plausible demo magnitudes.
 */
export const mockFleetStats: FleetStats = {
  totalVehicles: 312,
  online: 225,
  offline: 87,
  stale: 0,
  unknown: 0,
  totalFleets: 6,
  totalDevices: 298,
};

/** 24-hour fleet activity series (driving / idle / stopped counts per hour). */
export const mockActivity: ActivityBucket[] = [
  { hour: 0, driving: 22, idle: 8, stopped: 282 },
  { hour: 1, driving: 18, idle: 6, stopped: 288 },
  { hour: 2, driving: 15, idle: 5, stopped: 292 },
  { hour: 3, driving: 20, idle: 6, stopped: 286 },
  { hour: 4, driving: 35, idle: 9, stopped: 268 },
  { hour: 5, driving: 68, idle: 14, stopped: 230 },
  { hour: 6, driving: 112, idle: 22, stopped: 178 },
  { hour: 7, driving: 158, idle: 28, stopped: 126 },
  { hour: 8, driving: 176, idle: 33, stopped: 103 },
  { hour: 9, driving: 184, idle: 36, stopped: 92 },
  { hour: 10, driving: 188, idle: 38, stopped: 86 },
  { hour: 11, driving: 182, idle: 40, stopped: 90 },
  { hour: 12, driving: 150, idle: 35, stopped: 127 },
  { hour: 13, driving: 168, idle: 38, stopped: 106 },
  { hour: 14, driving: 186, idle: 39, stopped: 87 },
  { hour: 15, driving: 190, idle: 41, stopped: 81 },
  { hour: 16, driving: 184, idle: 40, stopped: 88 },
  { hour: 17, driving: 172, idle: 36, stopped: 104 },
  { hour: 18, driving: 140, idle: 30, stopped: 142 },
  { hour: 19, driving: 96, idle: 24, stopped: 192 },
  { hour: 20, driving: 64, idle: 18, stopped: 230 },
  { hour: 21, driving: 42, idle: 14, stopped: 256 },
  { hour: 22, driving: 30, idle: 11, stopped: 271 },
  { hour: 23, driving: 24, idle: 9, stopped: 279 },
].map((b) => ({
  hour: b.hour,
  driving: b.driving ?? 0,
  idle: b.idle ?? 0,
  stopped: b.stopped ?? 0,
}));

/** Active alerts, severity-sorted (critical first) — wireframe §1.3. */
export const mockAlerts: FleetAlert[] = [
  {
    id: 'a1',
    type: 'overspeed',
    severity: 'critical',
    vehicleLabel: 'Truck-42',
    detail: '128 km/h',
    occurredAt: '2026-08-07T14:31:00',
  },
  {
    id: 'a2',
    type: 'fcw',
    severity: 'critical',
    vehicleLabel: 'Truck-55',
    detail: 'Forward collision warning',
    occurredAt: '2026-08-07T14:18:00',
  },
  {
    id: 'a3',
    type: 'idle',
    severity: 'warning',
    vehicleLabel: 'Van-07',
    detail: 'Idle 18m+',
    occurredAt: '2026-08-07T14:05:00',
  },
  {
    id: 'a4',
    type: 'geofence',
    severity: 'warning',
    vehicleLabel: 'Truck-19',
    detail: 'Exited Depot-N',
    occurredAt: '2026-08-07T13:52:00',
  },
  {
    id: 'a5',
    type: 'dtc',
    severity: 'warning',
    vehicleLabel: 'Truck-19',
    detail: 'P0420 catalyst',
    occurredAt: '2026-08-07T13:40:00',
  },
  {
    id: 'a6',
    type: 'lowBattery',
    severity: 'info',
    vehicleLabel: 'Bus-12',
    detail: 'Battery 11%',
    occurredAt: '2026-08-07T13:22:00',
  },
  {
    id: 'a7',
    type: 'overspeed',
    severity: 'warning',
    vehicleLabel: 'Van-03',
    detail: '112 km/h',
    occurredAt: '2026-08-07T12:58:00',
  },
];

/** Fleet utilization breakdown (wireframe: 73% / Driving 59% / Idle 13% / Stopped 19% / Offline 9%). */
export const mockUtilization: FleetUtilization = {
  utilization: 73,
  breakdown: [
    { state: 'driving', percent: 59 },
    { state: 'idle', percent: 13 },
    { state: 'stopped', percent: 19 },
    { state: 'offline', percent: 9 },
  ],
};

/**
 * Fleet vehicles for the live-tracking map (UI_UX_Design.md §2).
 *
 * Seeded deterministically so demos are reproducible: 8 hand-authored vehicles
 * (kept verbatim so the dashboard preview stays stable) + a generated ring of
 * ~32 more spread around the Tehran depot, with a realistic mix of states,
 * drivers, body types, and recent position timestamps. When the GPS engine's
 * `GET /api/v1/tracking/vehicles/positions` + WebSocket broadcaster land, the
 * query layer swaps this for live data and the types/UI stay unchanged.
 */
const DRIVERS = [
  'M. Chen',
  'A. Rezai',
  'S. Karimi',
  'R. Ahmadi',
  'L. Park',
  'D. Costa',
  'N. Yazdani',
  'H. Müller',
  'F. Ahmadi',
  'T. Okonkwo',
] as const;
const TYPES: VehicleType[] = ['truck', 'van', 'bus', 'car'];
const TYPE_LABEL: Record<VehicleType, string> = {
  truck: 'Truck',
  van: 'Van',
  bus: 'Bus',
  car: 'Car',
};

/** Tiny deterministic PRNG (mulberry32) — no Math.random so tests are stable. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a deterministic ~40-vehicle fleet around the Tehran depot. */
function buildMockFleet(): MapVehicle[] {
  const now = Date.now();
  const rand = seeded(20260808);
  const fleet: MapVehicle[] = [];

  for (let i = 0; i < 40; i++) {
    const type = TYPES[Math.floor(rand() * TYPES.length)] ?? 'truck';
    const roll = rand();
    // Realistic-ish state distribution: ~55% driving, ~15% idle, ~15% stopped, ~12% offline, ~3% overspeed.
    const state: MapVehicle['state'] =
      roll > 0.97
        ? 'overspeed'
        : roll > 0.85
          ? 'offline'
          : roll > 0.7
            ? 'stopped'
            : roll > 0.55
              ? 'idle'
              : 'driving';
    const moving = state === 'driving' || state === 'overspeed';
    const heading = moving ? Math.round(rand() * 360) : 0;
    const speed =
      state === 'overspeed'
        ? 115 + Math.round(rand() * 25)
        : state === 'driving'
          ? 40 + Math.round(rand() * 60)
          : 0;
    // Spread within ~±0.06° (~6 km) of the depot at [51.338, 35.719].
    const lat = +(35.719 + (rand() - 0.5) * 0.12).toFixed(5);
    const lng = +(51.338 + (rand() - 0.5) * 0.12).toFixed(5);
    const updatedAt = new Date(now - Math.round(rand() * 600_000)).toISOString(); // last 0–10 min
    // REAL Sprint E fields: the device connection projection (§18) mirrors the
    // movement state offline/online split so the dashboard stat chips, the map
    // presence filters, and the list rows agree in mock mode. Devices that are
    // not transmitting report an older last-seen (§19).
    const presence: VehiclePresence = state === 'offline' ? 'OFFLINE' : 'ONLINE';
    const lastSeenAt =
      presence === 'OFFLINE'
        ? new Date(now - 6 * 3600_000 - Math.round(rand() * 3600_000)).toISOString() // 6–7h ago
        : updatedAt;
    fleet.push({
      id: `mv${i + 1}`,
      label: `${TYPE_LABEL[type]}-${String(100 + i)}`,
      type,
      state,
      lat,
      lng,
      heading,
      speed,
      driver: state === 'offline' ? undefined : DRIVERS[Math.floor(rand() * DRIVERS.length)],
      ignitionOn: state !== 'offline' && state !== 'stopped',
      updatedAt,
      deviceId: `mock-device-${i + 1}`,
      presence,
      lastSeenAt,
    });
  }
  return fleet;
}

export const mockMapVehicles: MapVehicle[] = buildMockFleet();

// ── Trips ────────────────────────────────────────────────────────────────────
//
// Deterministic trip list + a replay-track factory. The list reuses the
// existing mock fleet (labels/drivers stay consistent), and the detail factory
// synthesizes a believable GPS track between two Tehran points, deriving
// stops/idle/overspeed events directly from the waypoints so the timeline,
// speed graph, and map markers all agree. When `GET /api/v1/trips` +
// `GET /api/v1/tracking/vehicles/{id}/replay` land, the query layer swaps these
// for real data and the types/UI stay unchanged.

const TRIP_ORIGINS = ['Depot-N', 'Warehouse-3', 'Port-Terminal', 'Depot-S'];
const TRIP_DESTINATIONS = ['Customer A', 'Distribution Center', 'Retail Hub-7', 'Cross-Dock-2'];
const SPEED_LIMIT_KMH = 100;

/**
 * Generate a realistic GPS track between two endpoints.
 *
 * Produces `count` waypoints with believable speed variation (accelerate →
 * cruise → decelerate, plus idle plateaus and occasional overspeed spikes),
 * spaced ~1–2 minutes apart, plus a heading derived from the bearing between
 * consecutive points.
 */
function buildWaypoints(
  rand: () => number,
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  startTs: number,
  count: number,
): TripWaypoint[] {
  const pts: TripWaypoint[] = [];
  // A few deliberate waypoints where the vehicle is stationary (idle/stop).
  const idleAt = new Set([Math.floor(count * 0.3), Math.floor(count * 0.65)]);
  let t = startTs;
  for (let i = 0; i < count; i++) {
    const frac = i / (count - 1);
    // Linear interpolation with a slight wobble for realism.
    const wobble = (rand() - 0.5) * 0.004;
    const lat = startLat + (endLat - startLat) * frac + wobble;
    const lng = startLng + (endLng - startLng) * frac + wobble;
    let speed: number;
    if (idleAt.has(i)) {
      speed = 0; // idle/stop plateau
    } else if (i < 3 || i > count - 3) {
      speed = 20 + Math.round(rand() * 30); // accel / decel
    } else if (rand() > 0.92) {
      speed = 108 + Math.round(rand() * 22); // overspeed spike
    } else {
      speed = 50 + Math.round(rand() * 35); // cruise
    }
    const heading = i === 0 ? Math.round(rand() * 360) : pts[i - 1]?.heading;
    pts.push({ ts: new Date(t).toISOString(), lat, lng, speed, heading });
    t += (60 + Math.round(rand() * 60)) * 1000; // +1–2 min per sample
  }
  return pts;
}

/** Derive stop/idle/overspeed events from a track (mirrors GPSEngine §4–§5). */
function deriveEvents(waypoints: TripWaypoint[]): TripEvent[] {
  const events: TripEvent[] = [];
  waypoints.forEach((w, i) => {
    if (w.speed === 0 && i > 0 && waypoints[i - 1]?.speed === 0) {
      // Treat consecutive zero-speed runs as one stop/idle event at the start.
      if (events.at(-1)?.type === 'stop') return;
      const isIdle = i % 2 === 0; // alternate stop/idle for variety
      events.push({
        id: `ev-${i}`,
        ts: w.ts,
        type: isIdle ? 'idle' : 'stop',
        lat: w.lat,
        lng: w.lng,
        label: isIdle ? 'Idle' : 'Stop',
        durationMin: 3 + Math.round((i % 3) * 2),
      });
    } else if (w.speed > SPEED_LIMIT_KMH) {
      events.push({
        id: `ev-${i}`,
        ts: w.ts,
        type: 'overspeed',
        lat: w.lat,
        lng: w.lng,
        label: `${w.speed} km/h`,
      });
    }
  });
  return events;
}

/** Build the deterministic trip list (12 trips over the last few days). */
function buildMockTrips(): Trip[] {
  const rand = seeded(54321);
  const fleet = mockMapVehicles;
  const now = Date.now();
  const statuses: Trip['status'][] = [
    'completed',
    'completed',
    'completed',
    'in_progress',
    'planned',
    'cancelled',
  ];
  const trips: Trip[] = [];
  for (let i = 0; i < 12; i++) {
    const v = fleet[Math.floor(rand() * fleet.length)] ?? fleet[0];
    const status = statuses[Math.floor(rand() * statuses.length)] ?? 'completed';
    const durationMin = 35 + Math.round(rand() * 220);
    const startOffset = Math.round(rand() * 86_400_000 * 4); // within ~4 days
    const startTime = new Date(now - startOffset).toISOString();
    const distanceKm = Math.round((rand() * 180 + 12) * 10) / 10;
    const maxSpeed = 90 + Math.round(rand() * 50);
    trips.push({
      id: `TR-${5000 + i}`,
      vehicleId: v.id,
      vehicleLabel: v.label,
      driverId: v.driver ? `d-${i}` : undefined,
      driver: v.driver,
      status,
      originLabel: TRIP_ORIGINS[i % TRIP_ORIGINS.length] ?? TRIP_ORIGINS[0],
      destinationLabel: TRIP_DESTINATIONS[i % TRIP_DESTINATIONS.length] ?? TRIP_DESTINATIONS[0],
      startTime,
      endTime: status === 'completed' || status === 'cancelled' ? startTime : undefined,
      distanceKm,
      durationMin,
      maxSpeed,
      avgSpeed: Math.round((distanceKm / (durationMin / 60)) * 10) / 10,
      stopCount: Math.round(rand() * 4),
      idleMin: Math.round(rand() * 25),
      fuelL: status !== 'planned' ? Math.round(rand() * 60 + 5) : undefined,
    });
  }
  // Newest first.
  return trips.sort((a, b) => Number(new Date(b.startTime)) - Number(new Date(a.startTime)));
}

export const mockTrips: Trip[] = buildMockTrips();

/**
 * Build enriched trip detail (list row + replay track + events).
 *
 * Mock: synthesizes a ~50-point track for the trip's vehicle and derives
 * events. When `GET /api/v1/trips/{id}` + the replay endpoint land, replace
 * this body with `apiGet` + the GeoJSON replay mapping.
 */
export function mockTripDetail(id: string): TripDetail {
  const trip = mockTrips.find((t) => t.id === id) ?? mockTrips[0];
  const rand = seeded(Number.parseInt(id.replace(/\D/g, '') || '1', 10) * 104729);
  const startLat = 35.719 + (rand() - 0.5) * 0.04;
  const startLng = 51.338 + (rand() - 0.5) * 0.04;
  const endLat = startLat + (rand() - 0.5) * 0.08;
  const endLng = startLng + (rand() - 0.5) * 0.08;
  const startTs = Number(new Date(trip.startTime));
  const count = 50;
  const waypoints = buildWaypoints(rand, startLat, startLng, endLat, endLng, startTs, count);
  const events = deriveEvents(waypoints);
  return { ...trip, waypoints, events };
}
