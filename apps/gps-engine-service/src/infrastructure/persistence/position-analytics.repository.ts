/**
 * Position analytics repository — grid aggregations over
 * `tracking.vehicle_positions` for the GPS-coverage heatmap and the
 * movement-pattern report.
 *
 * Every query is tenant-scoped by `tenant_id = ?` (the hypertable has no RLS —
 * see the Sprint B RLS migration note) and bounded by the validated time
 * window plus a cell cap. Fixes are bucketed into a square degree grid
 * (`floor(lat/step)`, `floor(lng/step)`); the pure scoring + hull helpers live
 * in `domain/spatial-analytics.ts`.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import { QUALITY_CODE } from '../../domain/quality.js';

/** A silent stretch longer than this, ending far away, is a coverage gap. */
const GAP_SECONDS = 180;
/** ...and "far away" means the vehicle moved at least this much while silent. */
const GAP_MIN_METERS = 300;
/** Time attributed to a single fix is capped (a parked, sleeping device). */
const DT_CAP_SECONDS = 600;
/** Below this speed a fix counts as stopped. */
const MOVING_KPH = 5;
/** Cell cap per response — keeps the payload bounded on month-long windows. */
const MAX_CELLS = 6_000;

export interface AnalyticsQuery {
  readonly tenantId: string;
  readonly from: Date;
  readonly to: Date;
  readonly stepDeg: number;
  readonly vehicleId?: string;
  /** IANA zone for the hour-of-day / weekday buckets. */
  readonly timeZone: string;
}

export interface CoverageCellRow {
  readonly gy: number;
  readonly gx: number;
  readonly points: number;
  readonly satPoints: number;
  readonly avgSatellites: number | null;
  readonly weakPoints: number;
  readonly noFixPoints: number;
  readonly lowQualityPoints: number;
  readonly gaps: number;
  readonly vehicles: number;
}

export interface MovementCellRow {
  readonly gy: number;
  readonly gx: number;
  readonly points: number;
  readonly movingSec: number;
  readonly stoppedSec: number;
  readonly vehicles: number;
  readonly avgMovingKph: number | null;
  readonly maxKph: number;
}

export interface HourBucketRow {
  /** 0 = Sunday … 6 = Saturday (Postgres DOW) in the requested zone. */
  readonly dow: number;
  readonly hour: number;
  readonly movingSec: number;
  readonly stoppedSec: number;
  readonly vehicles: number;
}

export interface VehicleMovementRow {
  readonly vehicleId: string;
  readonly points: number;
  readonly distanceKm: number;
  readonly movingSec: number;
  readonly stoppedSec: number;
  readonly maxKph: number;
  readonly avgMovingKph: number | null;
  readonly activeDays: number;
  readonly cells: number;
  readonly firstSeen: string;
  readonly lastSeen: string;
}

export class PositionAnalyticsRepository {
  constructor(private readonly knex: Knex) {}

  /**
   * Per-cell GPS quality. Satellites come from `metadata.satellites` (persisted
   * by the pipeline) or, for Meitrack CCE rows, `metadata.cce.status`; the
   * device "GPS invalid" flag counts as a no-fix. Gaps are attributed to the
   * cell where the vehicle went silent.
   */
  public async coverageCells(q: AnalyticsQuery): Promise<CoverageCellRow[]> {
    const { sql, bindings } = this.base(q);
    const result = await this.knex.raw(
      `WITH ${sql},
       gaps AS (
         SELECT floor(prev_lat / ?)::int AS gy, floor(prev_lng / ?)::int AS gx, count(*) AS gaps
           FROM pts
          WHERE prev_at IS NOT NULL
            AND extract(epoch FROM captured_at - prev_at) > ?
            AND dist_m > ?
          GROUP BY 1, 2
       ),
       cells AS (
         SELECT floor(latitude / ?)::int AS gy, floor(longitude / ?)::int AS gx,
                count(*) AS points,
                count(sats) AS sat_points,
                avg(sats) AS avg_sats,
                count(*) FILTER (WHERE sats BETWEEN 1 AND 4) AS weak_points,
                count(*) FILTER (WHERE sats = 0 OR gps_valid = 'false') AS nofix_points,
                count(*) FILTER (WHERE quality IN (?, ?)) AS lowq_points,
                count(DISTINCT vehicle_id) AS vehicles
           FROM pts
          GROUP BY 1, 2
       )
       SELECT coalesce(c.gy, g.gy) AS gy, coalesce(c.gx, g.gx) AS gx,
              coalesce(c.points, 0) AS points, coalesce(c.sat_points, 0) AS sat_points,
              c.avg_sats, coalesce(c.weak_points, 0) AS weak_points,
              coalesce(c.nofix_points, 0) AS nofix_points,
              coalesce(c.lowq_points, 0) AS lowq_points,
              coalesce(g.gaps, 0) AS gaps, coalesce(c.vehicles, 0) AS vehicles
         FROM cells c FULL OUTER JOIN gaps g ON g.gy = c.gy AND g.gx = c.gx
        ORDER BY coalesce(c.points, 0) + coalesce(g.gaps, 0) DESC
        LIMIT ?`,
      [
        ...bindings,
        q.stepDeg,
        q.stepDeg,
        GAP_SECONDS,
        GAP_MIN_METERS,
        q.stepDeg,
        q.stepDeg,
        QUALITY_CODE.LOW_ACCURACY,
        QUALITY_CODE.SUSPECT_JUMP,
        MAX_CELLS,
      ],
    );
    return rowsOf(result).map((r) => ({
      gy: num(r.gy),
      gx: num(r.gx),
      points: num(r.points),
      satPoints: num(r.sat_points),
      avgSatellites: r.avg_sats === null ? null : round1(num(r.avg_sats)),
      weakPoints: num(r.weak_points),
      noFixPoints: num(r.nofix_points),
      lowQualityPoints: num(r.lowq_points),
      gaps: num(r.gaps),
      vehicles: num(r.vehicles),
    }));
  }

  /** Per-cell activity: time spent moving vs stopped, distinct vehicles, speeds. */
  public async movementCells(q: AnalyticsQuery): Promise<MovementCellRow[]> {
    const { sql, bindings } = this.base(q);
    const result = await this.knex.raw(
      `WITH ${sql}
       SELECT floor(latitude / ?)::int AS gy, floor(longitude / ?)::int AS gx,
              count(*) AS points,
              coalesce(sum(dt) FILTER (WHERE speed_kmh >= ?), 0) AS moving_sec,
              coalesce(sum(dt) FILTER (WHERE speed_kmh < ?), 0) AS stopped_sec,
              count(DISTINCT vehicle_id) AS vehicles,
              avg(speed_kmh) FILTER (WHERE speed_kmh >= ?) AS avg_moving,
              max(speed_kmh) AS max_kph
         FROM pts
        GROUP BY 1, 2
        ORDER BY count(*) DESC
        LIMIT ?`,
      [...bindings, q.stepDeg, q.stepDeg, MOVING_KPH, MOVING_KPH, MOVING_KPH, MAX_CELLS],
    );
    return rowsOf(result).map((r) => ({
      gy: num(r.gy),
      gx: num(r.gx),
      points: num(r.points),
      movingSec: Math.round(num(r.moving_sec)),
      stoppedSec: Math.round(num(r.stopped_sec)),
      vehicles: num(r.vehicles),
      avgMovingKph: r.avg_moving === null ? null : round1(num(r.avg_moving)),
      maxKph: round1(num(r.max_kph)),
    }));
  }

  /** Weekday × hour activity matrix in the requested time zone. */
  public async hourBuckets(q: AnalyticsQuery): Promise<HourBucketRow[]> {
    const { sql, bindings } = this.base(q);
    const result = await this.knex.raw(
      `WITH ${sql}
       SELECT extract(dow FROM captured_at AT TIME ZONE ?)::int AS dow,
              extract(hour FROM captured_at AT TIME ZONE ?)::int AS hour,
              coalesce(sum(dt) FILTER (WHERE speed_kmh >= ?), 0) AS moving_sec,
              coalesce(sum(dt) FILTER (WHERE speed_kmh < ?), 0) AS stopped_sec,
              count(DISTINCT vehicle_id) AS vehicles
         FROM pts
        GROUP BY 1, 2
        ORDER BY 1, 2`,
      [...bindings, q.timeZone, q.timeZone, MOVING_KPH, MOVING_KPH],
    );
    return rowsOf(result).map((r) => ({
      dow: num(r.dow),
      hour: num(r.hour),
      movingSec: Math.round(num(r.moving_sec)),
      stoppedSec: Math.round(num(r.stopped_sec)),
      vehicles: num(r.vehicles),
    }));
  }

  /**
   * Per-vehicle movement summary. Distance sums consecutive hops that look
   * like real driving (short silence, plausible jump) so GPS spikes and
   * overnight relocations do not inflate it.
   */
  public async vehicleSummaries(q: AnalyticsQuery): Promise<VehicleMovementRow[]> {
    const { sql, bindings } = this.base(q);
    const result = await this.knex.raw(
      `WITH ${sql}
       SELECT vehicle_id,
              count(*) AS points,
              coalesce(sum(dist_m) FILTER (
                WHERE prev_at IS NOT NULL
                  AND extract(epoch FROM captured_at - prev_at) <= ?
                  AND dist_m < 5000
              ), 0) / 1000.0 AS distance_km,
              coalesce(sum(dt) FILTER (WHERE speed_kmh >= ?), 0) AS moving_sec,
              coalesce(sum(dt) FILTER (WHERE speed_kmh < ?), 0) AS stopped_sec,
              max(speed_kmh) AS max_kph,
              avg(speed_kmh) FILTER (WHERE speed_kmh >= ?) AS avg_moving,
              count(DISTINCT (captured_at AT TIME ZONE ?)::date) AS active_days,
              count(DISTINCT (floor(latitude / ?)::int, floor(longitude / ?)::int)) AS cells,
              min(captured_at) AS first_seen,
              max(captured_at) AS last_seen
         FROM pts
        GROUP BY vehicle_id
        ORDER BY distance_km DESC`,
      [
        ...bindings,
        DT_CAP_SECONDS,
        MOVING_KPH,
        MOVING_KPH,
        MOVING_KPH,
        q.timeZone,
        q.stepDeg,
        q.stepDeg,
      ],
    );
    return rowsOf(result).map((r) => ({
      vehicleId: String(r.vehicle_id),
      points: num(r.points),
      distanceKm: round1(num(r.distance_km)),
      movingSec: Math.round(num(r.moving_sec)),
      stoppedSec: Math.round(num(r.stopped_sec)),
      maxKph: round1(num(r.max_kph)),
      avgMovingKph: r.avg_moving === null ? null : round1(num(r.avg_moving)),
      activeDays: num(r.active_days),
      cells: num(r.cells),
      firstSeen: new Date(r.first_seen as string).toISOString(),
      lastSeen: new Date(r.last_seen as string).toISOString(),
    }));
  }

  /**
   * The shared `pts` CTE: the tenant's persisted fixes in the window (REJECTED
   * dropped), with the previous fix, the hop distance (equirectangular metres),
   * and the time the fix "covers" until the next one (capped).
   */
  private base(q: AnalyticsQuery): { sql: string; bindings: unknown[] } {
    const vehicleFilter = q.vehicleId ? 'AND vehicle_id = ?::uuid' : '';
    const sql = `pts AS (
         SELECT vehicle_id, captured_at, latitude, longitude, speed_kmh, quality,
                coalesce(
                  CASE WHEN metadata->>'satellites' ~ '^[0-9]+$' THEN (metadata->>'satellites')::int END,
                  CASE WHEN metadata->'cce'->'status'->>'satellites' ~ '^[0-9]+$'
                       THEN (metadata->'cce'->'status'->>'satellites')::int END
                ) AS sats,
                metadata->'cce'->'status'->>'gpsValid' AS gps_valid,
                prev_at, prev_lat, prev_lng,
                CASE WHEN prev_at IS NULL THEN 0 ELSE
                  ${METERS_SQL} END AS dist_m,
                least(coalesce(extract(epoch FROM next_at - captured_at), 0), ${DT_CAP_SECONDS}) AS dt
           FROM (
             SELECT vehicle_id, captured_at, latitude, longitude, speed_kmh, quality, metadata,
                    lag(captured_at) OVER w AS prev_at,
                    lag(latitude) OVER w AS prev_lat,
                    lag(longitude) OVER w AS prev_lng,
                    lead(captured_at) OVER w AS next_at
               FROM tracking.vehicle_positions
              WHERE tenant_id = ?::uuid
                AND captured_at >= ? AND captured_at <= ?
                AND quality <> ?
                ${vehicleFilter}
             WINDOW w AS (PARTITION BY vehicle_id ORDER BY captured_at)
           ) raw
       )`;
    const bindings: unknown[] = [q.tenantId, q.from, q.to, QUALITY_CODE.REJECTED];
    if (q.vehicleId) bindings.push(q.vehicleId);
    return { sql, bindings };
  }
}

/** Equirectangular hop length in metres between (prev_lat, prev_lng) and the fix. */
const METERS_SQL = `111320.0 * sqrt(
                    power(latitude - prev_lat, 2) +
                    power((longitude - prev_lng) * cos(radians(latitude)), 2))`;

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
