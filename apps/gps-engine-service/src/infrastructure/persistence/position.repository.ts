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
import { withTenantContext } from '@fleetvision/persistence-knex';
import type { PositionEvent } from '../../domain/position-event.js';
import { QUALITY_CODE } from '../../domain/quality.js';

const TABLE = 'vehicle_positions';
const SCHEMA = 'tracking';

/**
 * Hard cap on a single position-history page. The history endpoint is a
 * range-bounded replay, not a generic list, so it is intentionally allowed to
 * exceed the standard list PAGE_SIZE — but it still must not return an
 * unbounded slice of the hypertable (Phase 6).
 */
const POSITION_HISTORY_MAX = 5000;

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
   * messageId) inserts nothing and does not throw. Uses a generated event_id from
   * the messageId UUIDv7 so redelivery collides cleanly.
   */
  public async insert(event: PositionEvent): Promise<void> {
    const geom = `SRID=4326;POINT(${event.longitude} ${event.latitude})`;
    // Run under tenant context so the RLS WITH CHECK admits the row.
    await withTenantContext(this.knex, event.tenantId, async (trx) => {
      await trx
        .withSchema(SCHEMA)
        .from(TABLE)
        .insert({
          event_id: trx.raw('?::uuid', [event.messageId]),
          vehicle_id: trx.raw('?::uuid', [event.vehicleId]),
          tenant_id: trx.raw('?::uuid', [event.tenantId]),
          captured_at: event.capturedAt,
          ingested_at: event.ingestedAt,
          geom: trx.raw('?::geography', [geom]),
          latitude: event.latitude,
          longitude: event.longitude,
          altitude_m: event.altitudeM,
          heading_deg: event.headingDeg,
          speed_kmh: event.speedKph,
          ignition_on: event.ignitionOn,
          quality: QUALITY_CODE[event.quality],
          metadata: trx.raw('?::jsonb', [JSON.stringify({ protocolId: event.protocolId })]),
        })
        .onConflict('event_id')
        .ignore();
    });
  }

  /** Whether a position with this messageId is already persisted (dedupe fast-path). */
  public async exists(tenantId: string, messageId: string): Promise<boolean> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = await trx
        .withSchema(SCHEMA)
        .from(TABLE)
        .whereRaw('event_id = ?::uuid', [messageId])
        .select(trx.raw('1'))
        .first();
      return row !== undefined;
    });
  }

  /** Latest position for a vehicle (cache-miss fallback). Null if none. */
  public async findLatest(tenantId: string, vehicleId: string): Promise<LatestPosition | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = await trx
        .withSchema(SCHEMA)
        .from(TABLE)
        .whereRaw('tenant_id = ?::uuid', [tenantId])
        .whereRaw('vehicle_id = ?::uuid', [vehicleId])
        .orderBy('captured_at', 'desc')
        .first();
      return row ? toLatest(row) : null;
    });
  }

  /** Range query for position history (REST endpoint). */
  public async findRange(
    tenantId: string,
    vehicleId: string,
    from: Date,
    to: Date,
    limit = 1000,
  ): Promise<LatestPosition[]> {
    // Hard cap: a single history request can never pull an unbounded slice of
    // the hypertable (Phase 6). 5000 rows covers a full-day 15s-tick replay.
    const effectiveLimit = Math.max(1, Math.min(POSITION_HISTORY_MAX, Math.trunc(limit)));
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = await trx
        .withSchema(SCHEMA)
        .from(TABLE)
        .whereRaw('tenant_id = ?::uuid', [tenantId])
        .whereRaw('vehicle_id = ?::uuid', [vehicleId])
        .where('captured_at', '>=', from)
        .where('captured_at', '<=', to)
        .orderBy('captured_at', 'asc')
        .limit(effectiveLimit);
      return rows.map((r) => toLatest(r));
    });
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
