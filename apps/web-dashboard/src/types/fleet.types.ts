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
  /** Current trip id, if assigned. */
  tripId?: string;
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

/** KPI summary — the top stat-card row (UI_UX_Design.md §1.3). */
export interface FleetStats {
  totalActive: number;
  driving: number;
  idle: number;
  offline: number;
  alerts: number;
  criticalAlerts: number;
  /** Delta vs yesterday, per metric (signed percentage points or count). */
  deltas: {
    totalActive: number;
    driving: number;
    idle: number;
    offline: number;
    alerts: number;
  };
  /** 7-point sparkline (oldest → newest) per card. */
  sparklines: {
    totalActive: number[];
    driving: number[];
    idle: number[];
    offline: number[];
    alerts: number[];
  };
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
export type AlertType =
  | 'overspeed'
  | 'idle'
  | 'geofence'
  | 'fcw'
  | 'dtc'
  | 'lowBattery';

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
export type WeatherCondition =
  | 'clear'
  | 'partly-cloudy'
  | 'cloudy'
  | 'rain'
  | 'storm'
  | 'snow';

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
