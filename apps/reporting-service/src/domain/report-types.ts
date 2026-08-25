/**
 * Report query contracts (Sprint J) — the wire shapes shared by the
 * repositories, services, and controller. All lists are bounded; aggregates
 * are GROUP BY results. `null` = not available (never a disguised zero —
 * see REPORTING-KPI-DEFINITIONS.md).
 */

export interface VehicleLabel {
  readonly vehicleId: string;
  readonly label: string;
  readonly fleetId: string | null;
  readonly fleetName: string | null;
}

/** Fleet overview (§6 + KPI expansions from REPORTING-KPI-DEFINITIONS). */
export interface FleetOverview {
  readonly totalVehicles: number;
  readonly vehiclesWithTelemetry: number;
  readonly noTelemetryVehicles: number;
  readonly movingVehicles: number;
  readonly idleVehicles: number;
  readonly parkedVehicles: number;
  readonly totalDistanceKm: number;
  readonly totalTrips: number;
  readonly totalAlarms: number;
  readonly openAlarms: number;
  readonly geofenceEvents: number;
  readonly avgUtilizationPct: number | null;
  /** SUM(COMPLETED trip duration_s) — KPI "Moving duration". */
  readonly movingDurationSec: number;
  /** SUM(closed idle_periods.duration_s) — KPI "Idle duration". */
  readonly idleDurationSec: number;
  /** SUM(ENDED parking_periods.duration_s, excl. TAMPER) — KPI "Parking duration". */
  readonly parkingDurationSec: number;
  /** distance / (moving hours); null when no completed trips. */
  readonly avgSpeedKmh: number | null;
  /** MAX(trip_events.max_speed_kmh) over COMPLETED trips; null when none. */
  readonly maxSpeedKmh: number | null;
  /** Count of notification.alerts with type='overspeed'. */
  readonly speedingEventCount: number;
  /** DISCARDED micro-trips in range (informational). */
  readonly discardedTrips: number;
}

/** Daily trend point (§13 + overview charts). */
export interface TrendPoint {
  readonly day: string; // YYYY-MM-DD (UTC)
  readonly distanceKm: number;
  readonly trips: number;
  readonly alarms: number;
}

export type AlarmTypeBucket = 'speeding' | 'geofence' | 'offline' | 'other';

export interface AlarmTrendPoint {
  readonly day: string;
  readonly speeding: number;
  readonly geofence: number;
  readonly offline: number;
  readonly other: number;
}

/** Per-vehicle utilization row (§7). */
export interface VehicleUtilizationRow {
  readonly vehicleId: string;
  readonly label: string;
  readonly movingSec: number;
  readonly idleSec: number;
  readonly parkingSec: number;
  readonly observedSec: number | null;
  readonly utilizationPct: number | null;
  readonly distanceKm: number;
  readonly trips: number;
}

/** Distance report row (§8). */
export interface DistanceRow {
  readonly vehicleId: string;
  readonly label: string;
  readonly distanceKm: number;
  readonly trips: number;
  readonly avgTripKm: number | null;
  readonly maxTripKm: number | null;
  readonly discardedTrips: number;
}

/** Trip report row (§9) — one COMPLETED trip. */
export interface TripReportRow {
  readonly id: string;
  readonly vehicleId: string;
  readonly label: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly durationSec: number;
  readonly distanceKm: number;
  readonly avgSpeedKph: number | null;
  readonly maxSpeedKph: number;
  readonly startLat: number;
  readonly startLng: number;
  readonly endLat: number | null;
  readonly endLng: number | null;
  readonly idleSec: number;
  readonly parkingSec: number;
}

/** Speed report row (§10). */
export interface SpeedRow {
  readonly vehicleId: string;
  readonly label: string;
  readonly avgSpeedKph: number | null;
  readonly maxSpeedKph: number | null;
  readonly speedingAlarms: number;
}

/** Idle/parking period row (§11). */
export interface ActivityPeriodRow {
  readonly id: string;
  readonly kind: 'IDLE' | 'PARKING';
  readonly vehicleId: string;
  readonly label: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly durationSec: number;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly status: string | null; // parking: ACTIVE|ENDED|TAMPER
}

/** Alarm aggregate row (§12). */
export interface AlarmAggregateRow {
  readonly vehicleId: string | null;
  readonly label: string | null;
  readonly type: string;
  readonly severity: string;
  readonly total: number;
  readonly open: number;
  readonly acknowledged: number;
  readonly resolved: number;
}

/** Geofence aggregate row (§14). */
export interface GeofenceReportRow {
  readonly geofenceId: string | null;
  readonly geofenceName: string | null;
  readonly vehicleId: string | null;
  readonly label: string | null;
  readonly enters: number;
  readonly exits: number;
  readonly dwells: number;
  readonly timeInsideSec: number;
}

/** Activity timeline event (§15). */
export interface ActivityEvent {
  readonly at: string;
  readonly source:
    | 'gps-engine.trips'
    | 'gps-engine.idle'
    | 'gps-engine.parking'
    | 'notification.fleet_events'
    | 'notification.alerts';
  readonly kind:
    | 'TRIP_STARTED'
    | 'TRIP_ENDED'
    | 'IDLE'
    | 'PARKING'
    | 'GEOFENCE_ENTER'
    | 'GEOFENCE_EXIT'
    | 'GEOFENCE_DWELL'
    | 'ALARM';
  readonly vehicleId: string | null;
  readonly label: string | null;
  readonly detail: string | null;
}

export interface CursorPage<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

/** Sort whitelists (§22) — the ONLY sortable fields per report. */
export const TRIP_SORT_FIELDS = {
  startedAt: 't.started_at',
  endedAt: 't.ended_at',
  duration: 't.duration_s',
  distance: 't.distance_km',
  maxSpeed: 't.max_speed_kmh',
} as const;
export type TripSortField = keyof typeof TRIP_SORT_FIELDS;

export const UTILIZATION_SORT_FIELDS = {
  label: 'v.label',
  moving: 'moving_sec',
  idle: 'idle_sec',
  parking: 'parking_sec',
  utilization: 'utilization_pct',
  distance: 'distance_km',
  trips: 'trips',
} as const;
export type UtilizationSortField = keyof typeof UTILIZATION_SORT_FIELDS;

export function resolveSort<K extends string>(
  value: string | undefined,
  whitelist: Record<K, string>,
  fallback: K,
): { field: K; direction: 'ASC' | 'DESC' } {
  const direction = value === 'asc' ? 'ASC' : 'DESC';
  if (value === 'asc' || value === 'desc' || value === undefined) {
    return { field: fallback, direction };
  }
  // format: "<field>" or "<field>:asc|desc"
  const [rawField, rawDir] = value.split(':');
  if (rawField && rawField in whitelist) {
    return { field: rawField as K, direction: rawDir === 'asc' ? 'ASC' : 'DESC' };
  }
  return { field: fallback, direction: 'DESC' };
}
