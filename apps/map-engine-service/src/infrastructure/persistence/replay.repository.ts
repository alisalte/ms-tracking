/**
 * Replay repository — reads `tracking.vehicle_positions` (the GPS Engine's
 * TimescaleDB hypertable) for map playback (08 §12.5, §9.4).
 *
 * The Map Engine has read-only access to the shared `tracking` schema. The query
 * uses chunk exclusion (hypertable partition on `captured_at`) + the composite
 * index `(tenant_id, vehicle_id, captured_at DESC)` for fast per-vehicle range
 * scans. For Sprint 9 the ≤1d raw path is the primary route; the continuous-
 * aggregate path (1d–7d) and S3 (>7d) are documented extension points.
 */
import type { Knex } from '@fleetvision/persistence-knex';

const SCHEMA = 'tracking';
const TABLE = 'vehicle_positions';

export interface ReplayPoint {
  readonly latitude: number;
  readonly longitude: number;
  readonly speedKmh: number;
  readonly headingDeg: number;
  readonly capturedAt: Date;
  readonly ignitionOn: boolean | null;
}

export class ReplayRepository {
  constructor(private readonly knex: Knex) {}

  /** Query position history for a vehicle within a time range. */
  public async findRange(
    tenantId: string,
    vehicleId: string,
    from: Date,
    to: Date,
    limit = 5000,
  ): Promise<ReplayPoint[]> {
    const rows = await this.knex
      .withSchema(SCHEMA)
      .from(TABLE)
      .select('latitude', 'longitude', 'speed_kmh', 'heading_deg', 'captured_at', 'ignition_on')
      .whereRaw('tenant_id = ?::uuid', [tenantId])
      .whereRaw('vehicle_id = ?::uuid', [vehicleId])
      .where('captured_at', '>=', from)
      .where('captured_at', '<=', to)
      .orderBy('captured_at', 'asc')
      .limit(limit);
    return (
      rows as Array<{
        latitude: number;
        longitude: number;
        speed_kmh: number;
        heading_deg: number | null;
        captured_at: Date | string;
        ignition_on: boolean | null;
      }>
    ).map((r) => ({
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      speedKmh: Number(r.speed_kmh),
      headingDeg: r.heading_deg !== null ? Number(r.heading_deg) : 0,
      capturedAt: new Date(r.captured_at),
      ignitionOn: r.ignition_on !== null ? Boolean(r.ignition_on) : null,
    }));
  }
}
