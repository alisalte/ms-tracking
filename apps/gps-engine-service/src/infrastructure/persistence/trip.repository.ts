/**
 * Trip repository — persists trip/idle/parking boundary events to the tracking
 * schema projections (07 §9.2, §10.6).
 *
 * Trips are insert-on-start, update-on-end (a single row per trip, transitioned
 * ACTIVE → COMPLETED). Idle and parking are insert-only (one row per period).
 * All inserts are best-effort from the trip engine's perspective — a persist
 * failure is logged but does not crash the pipeline.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import type { IdleEvent, ParkingEvent, TripBoundaryEvent } from '../../domain/trip/trip-types.js';

const SCHEMA = 'tracking';

export class TripRepository {
  constructor(private readonly knex: Knex) {}

  // --- Trips ---

  /** Insert a new ACTIVE trip row (on trip.started). */
  public async insertTripStart(event: TripBoundaryEvent): Promise<void> {
    await this.knex
      .withSchema(SCHEMA)
      .from('trip_events')
      .insert({
        tenant_id: this.knex.raw('?::uuid', [event.tenantId]),
        vehicle_id: this.knex.raw('?::uuid', [event.vehicleId]),
        status: 'ACTIVE',
        started_at: event.startedAt,
        start_lat: event.startLat,
        start_lng: event.startLng,
        distance_km: 0,
        duration_s: 0,
        max_speed_kmh: event.maxSpeedKmh,
        stop_count: 0,
      });
  }

  /** Close the latest ACTIVE trip for a vehicle (on trip.ended). */
  public async completeTrip(event: TripBoundaryEvent): Promise<void> {
    await this.knex
      .withSchema(SCHEMA)
      .from('trip_events')
      .whereRaw('vehicle_id = ?::uuid', [event.vehicleId])
      .whereRaw('tenant_id = ?::uuid', [event.tenantId])
      .where('status', 'ACTIVE')
      .orderBy('started_at', 'desc')
      .first()
      .update({
        status: 'COMPLETED',
        ended_at: event.endedAt,
        end_lat: event.endLat,
        end_lng: event.endLng,
        distance_km: event.distanceKm,
        duration_s: event.durationSec,
        max_speed_kmh: event.maxSpeedKmh,
        stop_count: event.stopCount,
        updated_at: this.knex.fn.now(),
      });
  }

  // --- Idle ---

  public async insertIdlePeriod(event: IdleEvent): Promise<void> {
    await this.knex
      .withSchema(SCHEMA)
      .from('idle_periods')
      .insert({
        tenant_id: this.knex.raw('?::uuid', [event.tenantId]),
        vehicle_id: this.knex.raw('?::uuid', [event.vehicleId]),
        started_at: event.startedAt,
        ended_at: event.type === 'idle.ended' ? event.endedAt : null,
        duration_s: event.durationSec,
        alerted: event.type === 'idle.alert',
      });
  }

  // --- Parking ---

  public async insertParkingPeriod(event: ParkingEvent): Promise<void> {
    await this.knex
      .withSchema(SCHEMA)
      .from('parking_periods')
      .insert({
        tenant_id: this.knex.raw('?::uuid', [event.tenantId]),
        vehicle_id: this.knex.raw('?::uuid', [event.vehicleId]),
        status:
          event.type === 'parking.tamper'
            ? 'TAMPER'
            : event.type === 'parking.ended'
              ? 'ENDED'
              : 'ACTIVE',
        started_at: event.startedAt,
        ended_at: event.type !== 'parking.started' ? event.endedAt : null,
        duration_s: event.durationSec,
        lat: event.lat,
        lng: event.lng,
      });
  }

  // --- Engine hours ---

  /** Persist a flushed engine-hours window (ignition-on accumulated seconds). */
  public async insertEngineHours(event: {
    tenantId: string;
    vehicleId: string;
    accumulatedSec: number;
    at: Date;
  }): Promise<void> {
    await this.knex
      .withSchema(SCHEMA)
      .from('engine_hours')
      .insert({
        tenant_id: this.knex.raw('?::uuid', [event.tenantId]),
        vehicle_id: this.knex.raw('?::uuid', [event.vehicleId]),
        accumulated_sec: event.accumulatedSec,
        recorded_at: event.at,
      });
  }
}
