/**
 * Position repository — TimescaleDB `tracking.vehicle_positions` access
 * (07 §9.2, 03 §11.1).
 *
 * Positions are immutable and append-only (INV-T01). Inserts are idempotent on
 * the event/message id (ON CONFLICT DO NOTHING) so Kafka redelivery does not
 * duplicate rows. `findLatest` serves the cache-miss fallback; `findRange`
 * serves the REST history endpoint.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import type { PositionEvent } from '../../domain/position-event.js';
import { QUALITY_CODE } from '../../domain/quality.js';

const TABLE = 'vehicle_positions';
const SCHEMA = 'tracking';

/** Latest-position read model returned to the API / cache-miss path. */
export interface LatestPosition {
  readonly vehicleId: string;
  readonly tenantId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly speedKph: number;
  readonly headingDeg: number;
  readonly altitudeM: number | null;
  readonly ignitionOn: boolean | null;
  readonly capturedAt: Date;
  readonly ingestedAt: Date;
  readonly quality: number;
}

export class PositionRepository {
  constructor(private readonly knex: Knex) {}

  /**
   * Persist a position event. Idempotent: a duplicate (same event_id derived from
   * messageId + same captured_at) inserts nothing and does not throw. Uses a
   * generated event_id from the messageId UUIDv7 so redelivery collides cleanly.
   * The conflict target is the composite PK (event_id, captured_at) — TimescaleDB
   * requires the partition column in every unique index, so there is no
   * single-column unique constraint on event_id alone.
   */
  public async insert(event: PositionEvent): Promise<void> {
    const geom = `SRID=4326;POINT(${event.longitude} ${event.latitude})`;
    await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .insert({
        event_id: this.knex.raw('?::uuid', [event.messageId]),
        vehicle_id: this.knex.raw('?::uuid', [event.vehicleId]),
        tenant_id: this.knex.raw('?::uuid', [event.tenantId]),
        captured_at: event.capturedAt,
        ingested_at: event.ingestedAt,
        geom: this.knex.raw('?::geography', [geom]),
        latitude: event.latitude,
        longitude: event.longitude,
        altitude_m: event.altitudeM,
        heading_deg: event.headingDeg,
        speed_kmh: event.speedKph,
        ignition_on: event.ignitionOn,
        quality: QUALITY_CODE[event.quality],
        metadata: this.knex.raw('?::jsonb', [JSON.stringify({ protocolId: event.protocolId })]),
      })
      .onConflict(['event_id', 'captured_at'])
      .ignore();
  }

  /** Whether a position with this messageId is already persisted (dedupe fast-path). */
  public async exists(messageId: string): Promise<boolean> {
    const row = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('event_id = ?::uuid', [messageId])
      .select(this.knex.raw('1'))
      .first();
    return row !== undefined;
  }

  /** Latest position for a vehicle (cache-miss fallback). Null if none. */
  public async findLatest(tenantId: string, vehicleId: string): Promise<LatestPosition | null> {
    const row = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('vehicle_id = ?::uuid', [vehicleId])
      .orderBy('captured_at', 'desc')
      .first();
    return row ? toLatest(row) : null;
  }

  /**
   * Latest position PER VEHICLE for a whole tenant (Sprint E §12/§21) — one
   * DISTINCT ON query instead of N per-vehicle lookups, so the live map can
   * bootstrap in a single request. Bounded by `limit` (caller clamps).
   */
  public async findLatestForTenant(tenantId: string, limit = 500): Promise<LatestPosition[]> {
    const rows = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .select('*')
      .distinctOn('vehicle_id')
      .orderBy('vehicle_id', 'desc')
      .orderBy('captured_at', 'desc')
      .limit(limit);
    return rows.map((r) => toLatest(r));
  }

  /** Range query for position history (REST endpoint). */
  public async findRange(
    tenantId: string,
    vehicleId: string,
    from: Date,
    to: Date,
    limit = 1000,
  ): Promise<LatestPosition[]> {
    const rows = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('vehicle_id = ?::uuid', [vehicleId])
      .where('captured_at', '>=', from)
      .where('captured_at', '<=', to)
      .orderBy('captured_at', 'asc')
      .limit(limit);
    return rows.map((r) => toLatest(r));
  }
}

/** Knex row shape for the vehicle_positions table (DB column names). */
interface PositionRow {
  vehicle_id: string;
  tenant_id: string;
  latitude: number;
  longitude: number;
  speed_kmh: number;
  heading_deg: number | null;
  altitude_m: number | null;
  ignition_on: boolean | null;
  captured_at: Date | string;
  ingested_at: Date | string;
  quality: number;
}

function toLatest(row: PositionRow): LatestPosition {
  return {
    vehicleId: String(row.vehicle_id),
    tenantId: String(row.tenant_id),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    speedKph: Number(row.speed_kmh),
    headingDeg: row.heading_deg !== null ? Number(row.heading_deg) : 0,
    altitudeM: row.altitude_m !== null ? Number(row.altitude_m) : null,
    ignitionOn: row.ignition_on !== null ? Boolean(row.ignition_on) : null,
    capturedAt: new Date(row.captured_at),
    ingestedAt: new Date(row.ingested_at),
    quality: Number(row.quality),
  };
}
