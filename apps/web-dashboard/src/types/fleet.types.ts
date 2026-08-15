/**
 * Fleet dashboard domain types (UI-facing, camelCase).
 *
 * These mirror the data contract documented in `UI_UX_Design.md` §1 (Fleet
 * Dashboard) and the Analytics-Reporting widget model. The wire (`*Wire`)
 * snake_case variants will be added here when the analytics/gps backends land
 * real endpoints; today the dashboard reads from static mock data
 * (`mock/fleet-data.ts`) so the UI is fully demoable.
 *
 * Color semantics live in `theme/palette.ts` (`status.*` + `mapAccents`); the
 * string keys here (e.g. `'critical'`, `'active'`) map to those tokens so the
 * UI never hardcodes hex values.
 */

/** Operational vehicle state — the axes of the stat-card row + utilization donut. */
export type VehicleState = 'driving' | 'idle' | 'stopped' | 'offline';

/** Vehicle body type — selects the marker shape / list icon (UI_UX_Design.md §2.4). */
export type VehicleType = 'truck' | 'van' | 'bus' | 'car';

/** A single vehicle tracked on the fleet map. */
export interface MapVehicle {
  id: string;
  /** Display label, e.g. "Truck-42". */
  label: string;
  state: VehicleState | 'overspeed';
  /** Decimal degrees (WGS84). */
  lat: number;
  lng: number;
  /** Compass heading 0–359. */
  heading: number;
  /** km/h. */
  speed: number;
  /** Driver display name, if assigned. */
  driver?: string;
  /** Body type — selects the marker shape. */
  type?: VehicleType;
  /** Engine ignition on/off (PositionResponse wire field). */
  ignitionOn?: boolean;
  /** ISO 8601 timestamp of the last position fix. */
  updatedAt?: string;
  /** Optional marker additions (Sprint E — from real gps-engine data). */
  deviceId?: string;
  /** Real connection state from gps-engine's device_status projection. */
  presence?: VehiclePresence;
  /** Backend-provided last-seen (ISO) — never fabricated client-side. */
  lastSeenAt?: string;
}

// ── Sprint E: REAL gps-engine wire types (live tracking bootstrap) ───────────

/** Device connection state (gps-engine tracking.device_status). */
export type DeviceConnectionState = 'ONLINE' | 'OFFLINE' | 'STALE';

/**
 * Vehicle presence shown in the UI (§18): the three real backend states plus
 * UNKNOWN = "no status record" (device never connected / not bound).
 */
export type VehiclePresence = DeviceConnectionState | 'UNKNOWN';

/** A device's connection status row (GET /tracking/devices/status). */
export interface DeviceConnection {
  deviceId: string;
  tenantId: string;
  state: DeviceConnectionState;
  protocolId: string | null;
  reason: string | null;
  lastSeenAt: string;
}

/** Latest position row (GET /positions/latest, GET /positions/:id/latest). */
export interface LatestPosition {
  vehicleId: string;
  tenantId: string;
  latitude: number;
  longitude: number;
  speedKph: number;
  headingDeg: number;
  altitudeM: number | null;
  ignitionOn: boolean | null;
  /** Device event time (§22 — never overwritten by server time). */
  capturedAt: string;
  /** Gateway ingestion time. */
  ingestedAt: string;
  /** Numeric quality code: 0 REJECTED, 1 VALID, 2 STALE, 3 LOW_ACCURACY, 4 SUSPECT_JUMP. */
  quality: number;
}

/** Recent event row in the device popup drawer (UI_UX_Design.md §2.5). */
export interface VehicleEvent {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  /** Human detail, e.g. "128 km/h". */
  detail: string;
  /** ISO timestamp. */
  occurredAt: string;
}

/** Enriched vehicle detail for the device popup drawer. */
export interface VehicleDetail extends MapVehicle {
  /** km/h, repeated from MapVehicle for the drawer. */
  odometer: number;
  /** Reverse-geocoded address of the current position. */
  address: string;
  /** Ignition flag (filled from the wire). */
  ignitionOn: boolean;
  /** ISO timestamp of the last position fix (filled). */
  updatedAt: string;
  /** Last ~5 events (overspeed / idle / geofence / DTC / AI). */
  events: VehicleEvent[];
}

/**
 * KPI summary — the top stat-card row (Sprint E §21: REAL backend data).
 * Registry counts come from fleet-management GET /summary; the online/offline/
 * stale split is gps-engine's device connection projection. `unknown` covers
 * vehicles with no device status record (unbound / never connected).
 */
export interface FleetStats {
  totalVehicles: number;
  online: number;
  offline: number;
  stale: number;
  unknown: number;
  totalFleets: number;
  totalDevices: number;
}

/** One hour bucket of the 24h fleet-activity chart. */
export interface ActivityBucket {
  /** Hour of day 0–23. */
  hour: number;
  driving: number;
  idle: number;
  stopped: number;
}

/** Alert severity — maps to `status.red` (critical) / `status.amber` (warning). */
export type AlertSeverity = 'critical' | 'warning' | 'info';

/** Alert category — selects the icon + i18n label. */
export type AlertType = 'overspeed' | 'idle' | 'geofence' | 'fcw' | 'dtc' | 'lowBattery';

/** A live alert row in the Active Alerts panel. */
export interface FleetAlert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  vehicleLabel: string;
  /** Human detail, e.g. "128 km/h" or "exited Depot-N". */
  detail: string;
  /** ISO timestamp. */
  occurredAt: string;
}

/** Attention-list item category — same icon vocabulary as the alert types. */
export type AttentionCategory = 'behavior' | 'maintenance' | 'ai' | 'device';

/** A row in "Vehicles Needing Attention". */
export interface AttentionItem {
  id: string;
  vehicleLabel: string;
  category: AttentionCategory;
  /** Short localized descriptor, e.g. "Overspeed · 14:31". */
  summary: string;
  /** ISO timestamp of the triggering event. */
  occurredAt: string;
}

/** Fleet utilization breakdown — donut + horizontal bars. */
export interface FleetUtilization {
  /** Headline utilization %. */
  utilization: number;
  breakdown: Array<{ state: VehicleState; percent: number }>;
}

/** Weather condition — selects the icon. */
export type WeatherCondition = 'clear' | 'partly-cloudy' | 'cloudy' | 'rain' | 'storm' | 'snow';

/** Current + 3-day forecast for the weather widget. */
export interface WeatherSnapshot {
  location: string;
  condition: WeatherCondition;
  /** Celsius. */
  temperature: number;
  feelsLike: number;
  humidity: number;
  /** km/h. */
  windSpeed: number;
  forecast: Array<{
    /** Short weekday label, e.g. "Mon". */
    day: string;
    condition: WeatherCondition;
    high: number;
    low: number;
  }>;
}

// ── Trips ────────────────────────────────────────────────────────────────────
//
// Trip-Route-Management (operational Trip aggregate) blended with the GPS
// Engine trip-boundary metrics (maxSpeed/stopCount/idle). UI-facing camelCase;
// the wire `*Wire` snake_case variants + GeoJSON replay contract
// (GPSEngine §8) map into these when the backend lands.

/** Operational trip lifecycle (subset of Trip-Route-Management's 13 states). */
export type TripStatus = 'completed' | 'in_progress' | 'planned' | 'cancelled';

/** A trip row — the list page + summary header. */
export interface Trip {
  id: string;
  vehicleId: string;
  /** Display label, e.g. "Truck-42". */
  vehicleLabel: string;
  driverId?: string;
  /** Driver display name, if assigned. */
  driver?: string;
  status: TripStatus;
  originLabel: string;
  destinationLabel: string;
  /** ISO start timestamp. */
  startTime: string;
  /** ISO end timestamp (omitted for in_progress/planned). */
  endTime?: string;
  /** km. */
  distanceKm: number;
  /** minutes. */
  durationMin: number;
  /** km/h — GPS trip-boundary metric. */
  maxSpeed: number;
  /** km/h. */
  avgSpeed: number;
  /** number of stops (stationary ≥ min-stop-duration, GPSEngine §4). */
  stopCount: number;
  /** minutes spent idling (ignition ON, speed ≤ idle threshold, §5). */
  idleMin: number;
  /** litres, if fuel data is available. */
  fuelL?: number;
}

/** One replay position sample (the replay endpoint's per-point shape). */
export interface TripWaypoint {
  /** ISO timestamp. */
  ts: string;
  /** Decimal degrees (WGS84). */
  lat: number;
  lng: number;
  /** km/h. */
  speed: number;
  /** Compass heading 0–359. */
  heading: number;
}

/** Event type surfaced as a marker on the timeline, speed graph, and map. */
export type TripEventType = 'stop' | 'idle' | 'overspeed' | 'geofence';

/** A layered replay event (GPSEngine §8 `include=events`). */
export interface TripEvent {
  id: string;
  /** ISO timestamp. */
  ts: string;
  type: TripEventType;
  lat: number;
  lng: number;
  /** Short localized descriptor, e.g. "Customer A" or "128 km/h". */
  label: string;
  /** minutes, for stop/idle events. */
  durationMin?: number;
}

/** Enriched trip detail — list row + the replay track + events. */
export interface TripDetail extends Trip {
  /** Ordered position samples for the replay. */
  waypoints: TripWaypoint[];
  /** Layered events derived from the track. */
  events: TripEvent[];
}
