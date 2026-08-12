/**
 * TripEngine — the segmentation orchestrator (07 §2 stage 3–5; §5).
 *
 * Consumes each validated position and runs the four independent per-vehicle
 * FSMs (trip, idle, parking) + the mileage accumulator + the engine-hours meter.
 * State is Redis-backed (07 §13.5) so a pod restart resumes mid-trip. Detected
 * boundaries are persisted (trip/idle/parking tables) and emitted to the signal
 * bus (→ WS broadcaster).
 *
 * Pipeline (per position):
 *   load FSM state + prevPos from Redis
 *   → compute filtered distance step (haversine)
 *   → advance trip FSM (may emit trip.started/ended + stop.detected)
 *   → advance idle FSM (may emit idle.started/ended/alert)
 *   → advance parking FSM (may emit parking.started/ended/tamper)
 *   → advance engine-hours (may flush on ignition-off)
 *   → persist events + save FSM state + emit signals
 *
 * Never throws on a single bad position — errors are caught and logged so the
 * position pipeline's offset advances. This mirrors the position pipeline's
 * resilience contract.
 */
import { Logger } from '@nestjs/common';
import type { GpsEngineConfig } from '../config/gps-engine.config.js';
import { PositionEvent } from '../domain/position-event.js';
import { filteredDistanceStep } from '../domain/trip/haversine.js';
import {
  INITIAL_IDLE_FSM,
  INITIAL_PARKING_FSM,
  INITIAL_TRIP_FSM,
  type IdleFsmState,
  type ParkingFsmState,
  type TripEngineThresholds,
  type TripFsmState,
} from '../domain/trip/trip-types.js';
import type { RedisFsmCache } from '../infrastructure/cache/redis-fsm-cache.js';
import type { RedisPositionCache } from '../infrastructure/cache/redis-position-cache.js';
import type { TripRepository } from '../infrastructure/persistence/trip.repository.js';
import { advanceEngineHours } from './fsm/engine-hours.js';
import { advanceIdleFsm } from './fsm/idle-fsm.js';
import { advanceParkingFsm } from './fsm/parking-fsm.js';
import { advanceTripFsm } from './fsm/trip-fsm.js';
import type { SignalBus } from './signal-bus.js';

export interface TripEngineDeps {
  readonly config: GpsEngineConfig;
  readonly fsmCache: RedisFsmCache;
  readonly positionCache: RedisPositionCache;
  readonly tripRepo: TripRepository;
  readonly signalBus: SignalBus;
}

export class TripEngine {
  private readonly logger = new Logger('TripEngine');

  constructor(private readonly deps: TripEngineDeps) {}

  /** Process one validated position through all FSMs. */
  public async process(position: PositionEvent): Promise<void> {
    const { tenantId, vehicleId } = position;
    try {
      const thresholds = this.thresholds();

      // Load FSM state + prev position from Redis.
      const tripState = (await this.deps.fsmCache.get<TripFsmState>(
        tenantId,
        vehicleId,
        'tripfsm',
      )) ?? {
        ...INITIAL_TRIP_FSM,
      };
      const idleState = (await this.deps.fsmCache.get<IdleFsmState>(
        tenantId,
        vehicleId,
        'idlefsm',
      )) ?? {
        ...INITIAL_IDLE_FSM,
      };
      const parkingState = (await this.deps.fsmCache.get<ParkingFsmState>(
        tenantId,
        vehicleId,
        'parkfsm',
      )) ?? {
        ...INITIAL_PARKING_FSM,
      };
      const odometerM = await this.deps.fsmCache.getNumber(tenantId, vehicleId, 'odo');
      const engineHoursSec = await this.deps.fsmCache.getNumber(tenantId, vehicleId, 'enginehours');

      const prevPos = await this.loadPrevPosition(position);

      // Mileage: filtered haversine step.
      const distanceStepM = prevPos
        ? filteredDistanceStep(
            prevPos.latitude,
            prevPos.longitude,
            position.latitude,
            position.longitude,
            prevPos.capturedAt,
            position.capturedAt,
            prevPos.speedKph,
            {
              dedupeDistanceM: thresholds.dedupeDistanceM,
              maxPlausibleSpeedKmh: thresholds.maxPlausibleSpeedKmh,
            },
          )
        : 0;
      const newOdometerM = odometerM + distanceStepM;

      // Advance the FSMs.
      const tripOut = advanceTripFsm({
        state: tripState,
        position,
        prevPosition: prevPos,
        distanceStepM,
        thresholds,
      });
      const idleOut = advanceIdleFsm({ state: idleState, position, thresholds });
      const parkingOut = advanceParkingFsm({ state: parkingState, position, thresholds });
      const ehOut = advanceEngineHours({
        accumulatedSec: engineHoursSec,
        prevPosition: prevPos,
        position,
      });

      // Persist boundary events (best-effort). Separate trip boundary events
      // from stop detections (stops have no dedicated table in Sprint 8).
      const tripBoundaries = tripOut.events.filter(
        (e): e is import('../domain/trip/trip-types.js').TripBoundaryEvent =>
          e.type === 'trip.started' || e.type === 'trip.ended',
      );
      await this.persistEvents(
        position,
        tripBoundaries,
        idleOut.events,
        parkingOut.events,
        ehOut.flushed,
      );

      // Save updated FSM state + scalars (best-effort).
      await this.saveState(
        position,
        tripOut.state,
        idleOut.state,
        parkingOut.state,
        newOdometerM,
        ehOut.accumulatedSec,
      );

      // Update prev-pos for the next position.
      await this.deps.positionCache.setPrevPos(position);

      // Emit signals (→ WS broadcaster).
      this.emitSignals(position, tripBoundaries, idleOut.events, parkingOut.events, ehOut.flushed);
    } catch (err) {
      this.logger.warn(`TripEngine error for vehicle ${vehicleId}: ${(err as Error).message}`);
    }
  }

  /** Load the previous position as a PositionEvent (or null on first sighting). */
  private async loadPrevPosition(position: PositionEvent): Promise<PositionEvent | null> {
    const cached = await this.deps.positionCache.getPrevPos(position.tenantId, position.vehicleId);
    if (!cached) return null;
    return new PositionEvent({
      messageId: 'prevpos',
      vehicleId: position.vehicleId,
      tenantId: position.tenantId,
      latitude: cached.latitude,
      longitude: cached.longitude,
      speedKph: cached.speedKph,
      headingDeg: cached.headingDeg,
      altitudeM: cached.altitudeM,
      satellites: null,
      ignitionOn: cached.ignitionOn,
      capturedAt: cached.capturedAt,
      ingestedAt: cached.ingestedAt,
      protocolId: position.protocolId,
      quality: 'VALID',
    });
  }

  /** Build the thresholds object from the config. */
  private thresholds(): TripEngineThresholds {
    const c = this.deps.config;
    return {
      tripStartSpeedKmh: c.GPS_TRIP_START_SPEED_KMH,
      tripStartDurationS: c.GPS_TRIP_START_DURATION_S,
      minTripDistanceM: c.GPS_TRIP_MIN_DISTANCE_M,
      tripStopSpeedKmh: c.GPS_TRIP_STOP_SPEED_KMH,
      minStopDurationS: c.GPS_TRIP_MIN_STOP_DURATION_S,
      maxGapInTripS: c.GPS_TRIP_MAX_GAP_S,
      idleSpeedKmh: c.GPS_IDLE_SPEED_KMH,
      idleThresholdS: c.GPS_IDLE_THRESHOLD_S,
      idleAlertThresholdS: c.GPS_IDLE_ALERT_THRESHOLD_S,
      parkingThresholdS: c.GPS_PARKING_THRESHOLD_S,
      dedupeDistanceM: c.GPS_MILEAGE_DEDUPE_DISTANCE_M,
      maxPlausibleSpeedKmh: c.GPS_MILEAGE_MAX_SPEED_KMH,
    };
  }

  /** Persist emitted events to the projection tables (best-effort). */
  private async persistEvents(
    position: PositionEvent,
    tripEvents: readonly import('../domain/trip/trip-types.js').TripBoundaryEvent[],
    idleEvents: readonly import('../domain/trip/trip-types.js').IdleEvent[],
    parkingEvents: readonly import('../domain/trip/trip-types.js').ParkingEvent[],
    engineHoursFlushed: number | null,
  ): Promise<void> {
    for (const e of tripEvents) {
      if (e.type === 'trip.started') await this.deps.tripRepo.insertTripStart(e);
      else if (e.type === 'trip.ended') await this.deps.tripRepo.completeTrip(e);
      // stop.detected events have no dedicated table in Sprint 8.
    }
    for (const e of idleEvents) {
      await this.deps.tripRepo.insertIdlePeriod(e);
    }
    for (const e of parkingEvents) {
      await this.deps.tripRepo.insertParkingPeriod(e);
    }
    // Persist the flushed engine-hours window (was previously discarded).
    if (engineHoursFlushed !== null && engineHoursFlushed > 0) {
      await this.deps.tripRepo.insertEngineHours({
        tenantId: position.tenantId,
        vehicleId: position.vehicleId,
        accumulatedSec: engineHoursFlushed,
        at: position.capturedAt,
      });
    }
  }

  /** Save the updated FSM state + scalars to Redis. */
  private async saveState(
    position: PositionEvent,
    tripState: TripFsmState,
    idleState: IdleFsmState,
    parkingState: ParkingFsmState,
    odometerM: number,
    engineHoursSec: number,
  ): Promise<void> {
    const { tenantId, vehicleId } = position;
    await this.deps.fsmCache.set(tenantId, vehicleId, 'tripfsm', tripState);
    await this.deps.fsmCache.set(tenantId, vehicleId, 'idlefsm', idleState);
    await this.deps.fsmCache.set(tenantId, vehicleId, 'parkfsm', parkingState);
    await this.deps.fsmCache.setNumber(tenantId, vehicleId, 'odo', odometerM);
    await this.deps.fsmCache.setNumber(tenantId, vehicleId, 'enginehours', engineHoursSec);
  }

  /** Emit signals to the bus for the WS broadcaster + downstream consumers. */
  private emitSignals(
    position: PositionEvent,
    tripEvents: readonly import('../domain/trip/trip-types.js').TripBoundaryEvent[],
    idleEvents: readonly import('../domain/trip/trip-types.js').IdleEvent[],
    parkingEvents: readonly import('../domain/trip/trip-types.js').ParkingEvent[],
    engineHoursFlushed: number | null,
  ): void {
    for (const e of tripEvents) {
      this.deps.signalBus.emitTrip(e);
    }
    for (const e of idleEvents) {
      this.deps.signalBus.emitIdle(e);
    }
    for (const e of parkingEvents) {
      this.deps.signalBus.emitParking(e);
    }
    if (engineHoursFlushed !== null) {
      this.deps.signalBus.emitEngineHours({
        type: 'engine.hours.accumulated',
        vehicleId: position.vehicleId,
        tenantId: position.tenantId,
        accumulatedSec: engineHoursFlushed,
        at: position.capturedAt,
      });
    }
  }
}
