/**
 * Trip Engine domain types — FSM states, boundary events, and threshold config
 * (07 §5; GPSEngine.md §4–§5).
 *
 * Four independent per-vehicle FSMs run concurrently (07 §5: trip, idle, and
 * parking are separate state machines so a config change to one does not perturb
 * the others). Stop is a classification emitted at the trip FSM's close
 * transition, not a standalone FSM.
 */

// --- Trip FSM (07 §5.2 / GPSEngine.md §4.1) --------------------------------

export type TripStateName = 'STOP' | 'MOVING' | 'PENDING_STOP' | 'CLOSED';

/** Persisted per-vehicle trip FSM snapshot (Redis `…:tripfsm`, TTL 6h). */
export interface TripFsmState {
  readonly state: TripStateName;
  /** When the current trip candidate opened (MOVING entry). */
  readonly tripStartAt: Date | null;
  /** Accumulated trip distance (meters) since tripStartAt. */
  readonly distanceM: number;
  /** Last position that registered movement (speed ≥ start-speed). */
  readonly lastMovingAt: Date | null;
  /** Position where the trip started (for the boundary event). */
  readonly startLat: number | null;
  readonly startLng: number | null;
  /** Max speed observed during the trip (km/h). */
  readonly maxSpeedKmh: number;
  /** Count of stops (PENDING_STOP→MOVING recoveries within the trip). */
  readonly stopCount: number;
}

export const INITIAL_TRIP_FSM: TripFsmState = {
  state: 'STOP',
  tripStartAt: null,
  distanceM: 0,
  lastMovingAt: null,
  startLat: null,
  startLng: null,
  maxSpeedKmh: 0,
  stopCount: 0,
};

/** Emitted when a trip starts or ends (07 §10.5: tracking.trip.started/ended.v1). */
export interface TripBoundaryEvent {
  readonly type: 'trip.started' | 'trip.ended';
  readonly vehicleId: string;
  readonly tenantId: string;
  readonly startLat: number;
  readonly startLng: number;
  readonly endLat: number;
  readonly endLng: number;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly distanceKm: number;
  readonly durationSec: number;
  readonly maxSpeedKmh: number;
  readonly stopCount: number;
}

/** Emitted when a trip closes — the location where it ended (07 §5.3). */
export interface StopDetectedEvent {
  readonly type: 'stop.detected';
  readonly vehicleId: string;
  readonly tenantId: string;
  readonly lat: number;
  readonly lng: number;
  readonly arrivedAt: Date;
  readonly purpose: 'UNRESOLVED'; // POI resolution via map-engine is a later sprint
}

// --- Idle FSM (07 §5.4 / GPSEngine.md §5) ----------------------------------

export type IdleStateName = 'ACTIVE' | 'IDLE';

export interface IdleFsmState {
  readonly state: IdleStateName;
  /** When the idle window opened (speed dropped below threshold while ign on). */
  readonly idleStartAt: Date | null;
  /** Whether the idle-alert has already fired for this window. */
  readonly alerted: boolean;
}

export const INITIAL_IDLE_FSM: IdleFsmState = {
  state: 'ACTIVE',
  idleStartAt: null,
  alerted: false,
};

export type IdleEventType = 'idle.started' | 'idle.ended' | 'idle.alert';

export interface IdleEvent {
  readonly type: IdleEventType;
  readonly vehicleId: string;
  readonly tenantId: string;
  readonly startedAt: Date | null;
  readonly endedAt: Date;
  readonly durationSec: number;
}

// --- Parking FSM (07 §5.5) --------------------------------------------------

export type ParkingStateName = 'UNPARKED' | 'PARKED';

export interface ParkingFsmState {
  readonly state: ParkingStateName;
  /** When parking began (ignition off + stationary). */
  readonly parkedAt: Date | null;
  readonly lat: number | null;
  readonly lng: number | null;
}

export const INITIAL_PARKING_FSM: ParkingFsmState = {
  state: 'UNPARKED',
  parkedAt: null,
  lat: null,
  lng: null,
};

export type ParkingEventType = 'parking.started' | 'parking.ended' | 'parking.tamper';

export interface ParkingEvent {
  readonly type: ParkingEventType;
  readonly vehicleId: string;
  readonly tenantId: string;
  readonly startedAt: Date | null;
  readonly endedAt: Date;
  readonly lat: number;
  readonly lng: number;
  readonly durationSec: number;
}

// --- Threshold config (07 §5.2/§5.4/§5.5; GPSEngine.md Appendix B) ----------

export interface TripEngineThresholds {
  // Trip
  readonly tripStartSpeedKmh: number; // 10
  readonly tripStartDurationS: number; // 30
  readonly minTripDistanceM: number; // 250
  readonly tripStopSpeedKmh: number; // 3
  readonly minStopDurationS: number; // 300
  readonly maxGapInTripS: number; // 600
  // Idle
  readonly idleSpeedKmh: number; // 1
  readonly idleThresholdS: number; // 180
  readonly idleAlertThresholdS: number; // 900
  // Parking
  readonly parkingThresholdS: number; // 1800
  // Mileage
  readonly dedupeDistanceM: number; // 1
  readonly maxPlausibleSpeedKmh: number; // 300 (jump filter cap)
}

/** Result of running all FSMs on one position — the events to emit/persist. */
export interface TripEngineResult {
  readonly trip: TripBoundaryEvent[];
  readonly stops: StopDetectedEvent[];
  readonly idle: IdleEvent[];
  readonly parking: ParkingEvent[];
  /** Updated derived odometer (meters) after this position. */
  readonly odometerM: number;
  /** Updated engine-hours accumulator (seconds). */
  readonly engineHoursSec: number;
  /** Whether ignition turned off on this position (engine-hours flush trigger). */
  readonly ignitionOff: boolean;
  readonly engineHoursAccumulated: number | null;
}
