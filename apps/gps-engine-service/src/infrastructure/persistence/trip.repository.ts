/**
 * Trip repository — persists trip/idle/parking/engine-hours boundary events to
 * the tracking schema projections (07 §9.2, §10.6).
 *
 * Trips are insert-on-start, update-on-end (a single row per trip, transitioned
 * ACTIVE → COMPLETED, or ACTIVE → DISCARDED for micro-trips). Idle and parking
 * are insert-only (one row per period). Engine-hours windows are insert-only and
 * idempotent on the triggering event id. All inserts are best-effort from the
 * trip engine's perspective — a persist failure is logged but does not crash the
 * pipeline.
 *
 * PostgreSQL note: `completeTrip`/`discardTrip` previously used UPDATE … ORDER
 * BY … LIMIT (a MySQL-ism PostgreSQL rejects). They now target a single row by
 * id selected via a deterministic tenant-scoped subquery (Sprint A fix).
 */
import type { Knex } from '@fleetvision/persistence-knex';
import type {
  EngineHoursFlushedEvent,
  IdleEvent,
  ParkingEvent,
  TripBoundaryEvent,
  TripDiscardedEvent,
} from '../../domain/trip/trip-types.js';

const SCHEMA = 'tracking';

/** Result of a trip close/discard: how many ACTIVE rows were transitioned. */
export interface TripTransitionResult {
  /** Rows updated (0 when no ACTIVE trip matched — e.g. already closed or none). */
  readonly updated: number;
}

export class TripRepository {
  constructor(private readonly knex: Knex) {}

  // --- Trips ---

  /** Insert a new ACTIVE trip row (on trip.started). Idempotent on sourceEventId (Sprint D §6). */
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
        source_event_id: event.sourceEventId ?? null,
      })
      .onConflict(['source_event_id'])
      .ignore();
  }

  /**
   * Close the latest ACTIVE trip for a vehicle (on trip.ended).
   *
   * Deterministic + tenant-safe: selects the newest ACTIVE row by id via a
   * tenant-scoped subquery, then updates exactly that row. Correct when multiple
   * ACTIVE rows exist (closes the most recent), returns `updated: 0` when there
   * is no ACTIVE trip to close. The single UPDATE is atomic in PostgreSQL, so no
   * explicit transaction is required.
   *
   * Concurrency (§14): the outer `status = 'ACTIVE'` guard makes a close robust
   * against a concurrent duplicate close — under READ COMMITTED, a second worker
   * that selected the same row before the first commits re-checks this predicate
   * at row-lock time and finds the row already COMPLETED, so it updates 0 rows
   * instead of overwriting (exactly-once close even under redelivery/rebalance).
   */
  public async completeTrip(event: TripBoundaryEvent): Promise<TripTransitionResult> {
    const result = (await this.knex.raw(
      `UPDATE tracking.trip_events
          SET status = 'COMPLETED',
              ended_at = ?,
              end_lat = ?,
              end_lng = ?,
              distance_km = ?,
              duration_s = ?,
              max_speed_kmh = ?,
              stop_count = ?,
              updated_at = now()
        WHERE status = 'ACTIVE'
          AND id = (
          SELECT id FROM tracking.trip_events
           WHERE tenant_id = ?::uuid
             AND vehicle_id = ?::uuid
             AND status = 'ACTIVE'
           ORDER BY started_at DESC, id DESC
           LIMIT 1
        )`,
      [
        event.endedAt,
        event.endLat,
        event.endLng,
        event.distanceKm,
        event.durationSec,
        event.maxSpeedKmh,
        event.stopCount,
        event.tenantId,
        event.vehicleId,
      ],
    )) as { rowCount?: number };
    return { updated: Number(result?.rowCount ?? 0) };
  }

  /**
   * Discard the latest ACTIVE trip for a vehicle (on trip.discarded, a micro-trip
   * that never reached min-trip-distance). Mirrors `completeTrip`'s selection but
   * transitions the row to DISCARDED so no orphan ACTIVE row remains. Idempotent:
   * a repeat discard (e.g. event replay) finds no ACTIVE row and returns 0. The
   * outer `status = 'ACTIVE'` guard provides the same concurrent-double-close
   * protection as `completeTrip`.
   */
  public async discardTrip(event: TripDiscardedEvent): Promise<TripTransitionResult> {
    const result = (await this.knex.raw(
      `UPDATE tracking.trip_events
          SET status = 'DISCARDED',
              ended_at = ?,
              end_lat = ?,
              end_lng = ?,
              distance_km = ?,
              duration_s = ?,
              updated_at = now()
        WHERE status = 'ACTIVE'
          AND id = (
          SELECT id FROM tracking.trip_events
           WHERE tenant_id = ?::uuid
             AND vehicle_id = ?::uuid
             AND status = 'ACTIVE'
           ORDER BY started_at DESC, id DESC
           LIMIT 1
        )`,
      [
        event.endedAt,
        event.endLat,
        event.endLng,
        event.distanceKm,
        event.durationSec,
        event.tenantId,
        event.vehicleId,
      ],
    )) as { rowCount?: number };
    return { updated: Number(result?.rowCount ?? 0) };
  }

  // --- Engine hours ---

  /**
   * Durably persist a flushed engine-hours window (on engine.hours.flushed).
   * Idempotent: the triggering position's messageId is the unique key, so Kafka
   * redelivery inserts nothing on the second pass (ON CONFLICT DO NOTHING).
   */
  public async insertEngineHours(event: EngineHoursFlushedEvent): Promise<void> {
    await this.knex
      .withSchema(SCHEMA)
      .from('engine_hours')
      .insert({
        tenant_id: this.knex.raw('?::uuid', [event.tenantId]),
        vehicle_id: this.knex.raw('?::uuid', [event.vehicleId]),
        window_start: event.windowStart,
        window_end: event.windowEnd,
        duration_s: event.durationSec,
        engine_hours: event.engineHours,
        source_event_id: this.knex.raw('?::uuid', [event.sourceEventId]),
      })
      .onConflict('source_event_id')
      .ignore();
  }

  // --- Idle ---

  /** Insert an idle period. Idempotent on sourceEventId (Sprint D §6). */
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
        source_event_id: event.sourceEventId ?? null,
      })
      .onConflict(['source_event_id'])
      .ignore();
  }

  // --- Parking ---

  /** Insert a parking period. Idempotent on sourceEventId (Sprint D §6). */
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
        source_event_id: event.sourceEventId ?? null,
      })
      .onConflict(['source_event_id'])
      .ignore();
  }

  // --- Read model (Sprint F §11: trip visualization without rebuilding the Trip Engine) ---

  /** Trips (any status) for a tenant/vehicle inside a time window, newest first. */
  public async findTrips(
    tenantId: string,
    opts: { vehicleId?: string; from: Date; to: Date; limit?: number },
  ): Promise<TripRecord[]> {
    let query = this.knex
      .withSchema(SCHEMA)
      .from('trip_events')
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .where('started_at', '>=', opts.from)
      .where('started_at', '<=', opts.to)
      .orderBy('started_at', 'desc')
      .limit(opts.limit ?? 50);
    if (opts.vehicleId) {
      query = query.whereRaw('vehicle_id = ?::uuid', [opts.vehicleId]);
    }
    const rows = await query;
    return (rows as TripRow[]).map(toTrip);
  }

  /** Single trip by id — tenant-scoped (no cross-tenant enumeration oracle). */
  public async findTripById(tenantId: string, tripId: string): Promise<TripRecord | null> {
    const row = await this.knex
      .withSchema(SCHEMA)
      .from('trip_events')
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('id = ?::uuid', [tripId])
      .first();
    return row ? toTrip(row as TripRow) : null;
  }

  /** Idle periods for a vehicle inside a window (trip-detail events). */
  public async findIdlePeriods(
    tenantId: string,
    vehicleId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ startedAt: Date; endedAt: Date | null; durationS: number }>> {
    const rows = await this.knex
      .withSchema(SCHEMA)
      .from('idle_periods')
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('vehicle_id = ?::uuid', [vehicleId])
      .where('started_at', '>=', from)
      .where('started_at', '<=', to)
      .orderBy('started_at', 'asc');
    return (
      rows as Array<{
        started_at: Date | string;
        ended_at: Date | string | null;
        duration_s: number;
      }>
    ).map((r) => ({
      startedAt: new Date(r.started_at),
      endedAt: r.ended_at ? new Date(r.ended_at) : null,
      durationS: Number(r.duration_s),
    }));
  }

  /** Parking periods for a vehicle inside a window (trip-detail events). */
  public async findParkingPeriods(
    tenantId: string,
    vehicleId: string,
    from: Date,
    to: Date,
  ): Promise<
    Array<{ startedAt: Date; endedAt: Date | null; durationS: number; lat: number; lng: number }>
  > {
    const rows = await this.knex
      .withSchema(SCHEMA)
      .from('parking_periods')
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('vehicle_id = ?::uuid', [vehicleId])
      .where('started_at', '>=', from)
      .where('started_at', '<=', to)
      .orderBy('started_at', 'asc');
    return (
      rows as Array<{
        started_at: Date | string;
        ended_at: Date | string | null;
        duration_s: number;
        lat: number;
        lng: number;
      }>
    ).map((r) => ({
      startedAt: new Date(r.started_at),
      endedAt: r.ended_at ? new Date(r.ended_at) : null,
      durationS: Number(r.duration_s),
      lat: Number(r.lat),
      lng: Number(r.lng),
    }));
  }
}

/** Trip read-model row (DB column names). */
interface TripRow {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  status: string;
  started_at: Date | string;
  ended_at: Date | string | null;
  start_lat: number;
  start_lng: number;
  end_lat: number | null;
  end_lng: number | null;
  distance_km: number;
  duration_s: number;
  max_speed_kmh: number;
  stop_count: number;
}

/** Trip read model returned by the REST API (camelCase). */
export interface TripRecord {
  readonly id: string;
  readonly vehicleId: string;
  readonly status: 'ACTIVE' | 'COMPLETED' | 'DISCARDED';
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly startLat: number;
  readonly startLng: number;
  readonly endLat: number | null;
  readonly endLng: number | null;
  readonly distanceKm: number;
  readonly durationS: number;
  readonly maxSpeedKmh: number;
  readonly stopCount: number;
}

function toTrip(row: TripRow): TripRecord {
  return {
    id: String(row.id),
    vehicleId: String(row.vehicle_id),
    status: row.status as TripRecord['status'],
    startedAt: new Date(row.started_at),
    endedAt: row.ended_at ? new Date(row.ended_at) : null,
    startLat: Number(row.start_lat),
    startLng: Number(row.start_lng),
    endLat: row.end_lat !== null ? Number(row.end_lat) : null,
    endLng: row.end_lng !== null ? Number(row.end_lng) : null,
    distanceKm: Number(row.distance_km),
    durationS: Number(row.duration_s),
    maxSpeedKmh: Number(row.max_speed_kmh),
    stopCount: Number(row.stop_count),
  };
}
