import type { TelemetryMetrics } from '@fleetvision/observability';
/**
 * TripEngine — the segmentation orchestrator (07 §2 stage 3–5; §5).
 *
 * Consumes each validated position and runs the four independent per-vehicle
 * FSMs (trip, idle, parking) + the mileage accumulator + the engine-hours meter.
 * State is Redis-backed (07 §13.5) so a pod restart resumes mid-trip. Detected
 * boundaries are persisted (trip/idle/parking/engine-hours tables) and emitted
 * to the signal bus (→ WS broadcaster).
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
  type EngineHoursFlushedEvent,
  INITIAL_IDLE_FSM,
  INITIAL_PARKING_FSM,
  INITIAL_TRIP_FSM,
  type IdleFsmState,
  type ParkingFsmState,
  type TripBoundaryEvent,
  type TripDiscardedEvent,
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
  /** Telemetry metrics (optional — tests construct the engine without). */
  readonly metrics?: TelemetryMetrics | null;
}

/**
 * Outcome of processing one position (Sprint D §21).
 * `OUT_OF_ORDER` = the position's event time precedes the last processed
 * position for the vehicle — it was NOT fed to the FSMs and did NOT update the
 * prev-pos baseline (the caller also skips the live broadcast for it).
 */
export type TripEngineOutcome = { skipped: 'OUT_OF_ORDER' } | { skipped: null };

export class TripEngine {
  private readonly logger = new Logger('TripEngine');
  private readonly metrics: TelemetryMetrics | null;

  constructor(private readonly deps: TripEngineDeps) {
    this.metrics = deps.metrics ?? null;
  }

  /**
   * Process one validated position through all FSMs.
   *
   * Sprint D §21 — out-of-order policy: real devices send delayed packets.
   * An out-of-order position (event time < the previous processed position)
   * is PERSISTED by the pipeline (the hypertable is a time-series — insertion
   * order is irrelevant) but is NOT fed to the FSMs and does NOT regress the
   * prev-pos/odometer baseline. Previously such a packet silently corrupted
   * the Δt-based accumulators (negative gaps, inflated jump-filter speeds,
   * regressed prevpos).
   */
  public async process(position: PositionEvent): Promise<TripEngineOutcome> {
    const { tenantId, vehicleId } = position;
    try {
      const thresholds = this.thresholds();

      // Load FSM state + prev position from Redis. FSM snapshots are stored as
      // JSON, so Date fields (tripStartAt, lastMovingAt, idleStartAt, parkedAt)
      // come back as ISO strings — revive them to Date before handing the state
      // to the pure FSMs (which call .getTime() on them). Without this revival a
      // trip crashes on its second position, leaving ACTIVE rows orphaned and
      // never flushing engine hours (Sprint A root-cause fix).
      const tripState = reviveTripState(
        (await this.deps.fsmCache.get<TripFsmState>(tenantId, vehicleId, 'tripfsm')) ?? {
          ...INITIAL_TRIP_FSM,
        },
      );
      const idleState = reviveIdleState(
        (await this.deps.fsmCache.get<IdleFsmState>(tenantId, vehicleId, 'idlefsm')) ?? {
          ...INITIAL_IDLE_FSM,
        },
      );
      const parkingState = reviveParkingState(
        (await this.deps.fsmCache.get<ParkingFsmState>(tenantId, vehicleId, 'parkfsm')) ?? {
          ...INITIAL_PARKING_FSM,
        },
      );
      const odometerM = await this.deps.fsmCache.getNumber(tenantId, vehicleId, 'odo');
      const engineHoursSec = await this.deps.fsmCache.getNumber(tenantId, vehicleId, 'enginehours');

      const prevPos = await this.loadPrevPosition(position);

      // Sprint D §21 — the out-of-order gate. Persist-only for this position.
      if (prevPos && position.capturedAt.getTime() < prevPos.capturedAt.getTime()) {
        this.metrics?.positions.inc({ result: 'out_of_order' });
        this.logger.debug(
          `Out-of-order position ${position.messageId} for vehicle ${vehicleId} ` +
            `(${position.capturedAt.toISOString()} < ${prevPos.capturedAt.toISOString()}) — FSMs skipped.`,
        );
        return { skipped: 'OUT_OF_ORDER' };
      }

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

      // Build the engine-hours flush event (if ignition turned off this step).
      // window_start is exact: the Δt accumulator telescopes to windowEnd − windowStart.
      const engineHoursFlushed =
        ehOut.flushed !== null && ehOut.flushed > 0
          ? ({
              type: 'engine.hours.flushed',
              vehicleId: position.vehicleId,
              tenantId: position.tenantId,
              durationSec: ehOut.flushed,
              windowEnd: position.capturedAt,
              windowStart: new Date(position.capturedAt.getTime() - ehOut.flushed * 1000),
              engineHours: ehOut.flushed / 3600,
              sourceEventId: position.messageId,
            } satisfies EngineHoursFlushedEvent)
          : null;

      // Persist boundary events (best-effort). Trip events include trip.discarded
      // (a micro-trip) so the ACTIVE row written on trip.started is reconciled.
      // stop.detected has no dedicated table in Sprint 8. Every persisted event
      // is stamped with the triggering position's messageId (sourceEventId) so
      // projection inserts are idempotent under Kafka redelivery (Sprint D §6).
      const source = position.messageId;
      const withSource = <T extends object>(e: T): T => ({ ...e, sourceEventId: source });
      const tripPersist = tripOut.events
        .filter(
          (e): e is TripBoundaryEvent | TripDiscardedEvent =>
            e.type === 'trip.started' || e.type === 'trip.ended' || e.type === 'trip.discarded',
        )
        .map(withSource);
      await this.persistEvents(
        tripPersist,
        idleOut.events.map(withSource),
        parkingOut.events.map(withSource),
        engineHoursFlushed,
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

      // Emit signals (→ WS broadcaster). Only user-facing trip boundaries
      // (started/ended) are signaled — trip.discarded is internal bookkeeping.
      const tripSignals = tripOut.events.filter(
        (e): e is TripBoundaryEvent => e.type === 'trip.started' || e.type === 'trip.ended',
      );
      this.emitSignals(
        position,
        tripSignals,
        idleOut.events,
        parkingOut.events,
        engineHoursFlushed,
      );
      return { skipped: null };
    } catch (err) {
      this.logger.warn(`TripEngine error for vehicle ${vehicleId}: ${(err as Error).message}`);
      return { skipped: null };
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
    tripEvents: readonly (TripBoundaryEvent | TripDiscardedEvent)[],
    idleEvents: readonly import('../domain/trip/trip-types.js').IdleEvent[],
    parkingEvents: readonly import('../domain/trip/trip-types.js').ParkingEvent[],
    engineHoursFlushed: EngineHoursFlushedEvent | null,
  ): Promise<void> {
    for (const e of tripEvents) {
      if (e.type === 'trip.started') {
        await this.deps.tripRepo.insertTripStart(e);
      } else if (e.type === 'trip.ended') {
        const { updated } = await this.deps.tripRepo.completeTrip(e);
        if (updated === 0) {
          // No ACTIVE row to close — e.g. trip.started persist failed earlier,
          // or a concurrent worker already closed it. Not fatal; surface it.
          this.logger.warn(
            `completeTrip found no ACTIVE trip for vehicle ${e.vehicleId} tenant ${e.tenantId}; nothing closed`,
          );
        }
      } else if (e.type === 'trip.discarded') {
        await this.deps.tripRepo.discardTrip(e);
        this.logger.debug(
          `Discarded micro-trip for vehicle ${e.vehicleId} tenant ${e.tenantId} (${e.distanceKm.toFixed(3)} km below threshold)`,
        );
      }
    }
    for (const e of idleEvents) {
      await this.deps.tripRepo.insertIdlePeriod(e);
    }
    for (const e of parkingEvents) {
      await this.deps.tripRepo.insertParkingPeriod(e);
    }
    if (engineHoursFlushed) {
      await this.deps.tripRepo.insertEngineHours(engineHoursFlushed);
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
    tripEvents: readonly TripBoundaryEvent[],
    idleEvents: readonly import('../domain/trip/trip-types.js').IdleEvent[],
    parkingEvents: readonly import('../domain/trip/trip-types.js').ParkingEvent[],
    engineHoursFlushed: EngineHoursFlushedEvent | null,
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
    if (engineHoursFlushed) {
      this.deps.signalBus.emitEngineHours({
        type: 'engine.hours.accumulated',
        vehicleId: position.vehicleId,
        tenantId: position.tenantId,
        accumulatedSec: engineHoursFlushed.durationSec,
        at: engineHoursFlushed.windowEnd,
      });
    }
  }
}

// --- FSM state hydration: revive Date fields deserialized from JSON ---

/** Coerce a JSON-deserialized value back into a Date (or null). */
function asDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function reviveTripState(s: TripFsmState): TripFsmState {
  return { ...s, tripStartAt: asDate(s.tripStartAt), lastMovingAt: asDate(s.lastMovingAt) };
}

function reviveIdleState(s: IdleFsmState): IdleFsmState {
  return { ...s, idleStartAt: asDate(s.idleStartAt) };
}

function reviveParkingState(s: ParkingFsmState): ParkingFsmState {
  return { ...s, parkedAt: asDate(s.parkedAt) };
}
