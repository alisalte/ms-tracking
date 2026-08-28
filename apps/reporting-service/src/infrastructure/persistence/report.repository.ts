/**
 * ReportRepository — Sprint J's analytical read layer.
 *
 * READ-ONLY SQL over the authoritative domain projections:
 *   tracking.trip_events / idle_periods / parking_periods / vehicle_positions
 *   notification.alerts / notification.fleet_events
 *   fleet.vehicles / fleet.fleets
 *   tracking.geofences (name join, read-only)
 *
 * Principles (Sprint J §23/§27/§28/§46):
 *   - DATABASE-SIDE aggregation (GROUP BY / CTE / time_bucket) — never
 *     SELECT-all-then-sum-in-JS.
 *   - Every query constrains tenant AND time before aggregation; parameters
 *     are bound (never interpolated).
 *   - Bounded execution: each query runs inside a READ-ONLY transaction with
 *     `SET LOCAL statement_timeout`.
 *   - No domain logic is re-derived: distance/idle/parking come from the
 *     GPS-engine projections; alarm counts from the alarm engine's records;
 *     geofence events from the Sprint I FleetEvent pipeline.
 *   - `null` (not 0) where a metric's source does not exist (offline
 *     duration, utilization without telemetry).
 */
import type { Knex } from '@fleetvision/persistence-knex';
import type {
  ActivityEvent,
  ActivityPeriodRow,
  AlarmAggregateRow,
  AlarmTrendPoint,
  DistanceRow,
  FleetComparisonRow,
  FleetOverview,
  GeofenceReportRow,
  SafetyScorecard,
  SpeedRow,
  TrendPoint,
  TripReportRow,
  VehicleUtilizationRow,
} from '../../domain/report-types.js';

export interface TimeWindow {
  readonly from: Date;
  readonly to: Date;
}

export interface VehicleFilter {
  readonly vehicleId?: string | undefined;
  readonly fleetId?: string | undefined;
}

export interface ReportRepositoryDeps {
  readonly knex: Knex;
  readonly queryTimeoutMs: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "name · plate" when both exist; otherwise name, plate, or code. */
const VEHICLE_LABEL_SQL = `CASE
  WHEN NULLIF(BTRIM(v.name), '') IS NOT NULL
   AND NULLIF(BTRIM(v.plate), '') IS NOT NULL
   AND BTRIM(v.name) IS DISTINCT FROM BTRIM(v.plate)
    THEN BTRIM(v.name) || ' · ' || BTRIM(v.plate)
  ELSE COALESCE(NULLIF(BTRIM(v.name), ''), NULLIF(BTRIM(v.plate), ''), NULLIF(BTRIM(v.code), ''))
END`;

export class ReportRepository {
  constructor(private readonly deps: ReportRepositoryDeps) {}

  /** READ-ONLY + statement-timeout wrapper for every report query (§46). */
  private async query<T>(fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    return this.deps.knex.transaction(async (trx) => {
      await trx.raw('SET LOCAL TRANSACTION READ ONLY');
      await trx.raw(`SET LOCAL statement_timeout = '${Math.floor(this.deps.queryTimeoutMs)}'`);
      return fn(trx);
    });
  }

  // ── Fleet overview (§6) ──────────────────────────────────────────────────

  public async fleetOverview(
    tenantId: string,
    win: TimeWindow,
    filter: VehicleFilter,
  ): Promise<FleetOverview> {
    const vf = vehicleFilterSql(tenantId, 'v', filter);
    return this.query(async (trx) => {
      const [row] = (
        await trx.raw(
          `
          WITH scope AS (
            SELECT v.id AS vehicle_id
            FROM fleet.vehicles v
            WHERE v.tenant_id = ?::uuid AND v.status = 'ACTIVE' ${vf.clause}
          ),
          moving AS (
            SELECT t.vehicle_id, SUM(t.duration_s)::bigint AS moving_sec,
                   SUM(t.distance_km) AS distance_km, COUNT(*)::bigint AS trips,
                   MAX(t.max_speed_kmh) AS max_speed_kmh
            FROM tracking.trip_events t
            JOIN scope s ON s.vehicle_id = t.vehicle_id
            WHERE t.tenant_id = ?::uuid AND t.status = 'COMPLETED'
              AND t.started_at >= ? AND t.started_at < ?
            GROUP BY t.vehicle_id
          ),
          discarded AS (
            SELECT COUNT(*)::bigint AS total
            FROM tracking.trip_events t
            JOIN scope s ON s.vehicle_id = t.vehicle_id
            WHERE t.tenant_id = ?::uuid AND t.status = 'DISCARDED'
              AND t.started_at >= ? AND t.started_at < ?
          ),
          idling AS (
            SELECT i.vehicle_id, SUM(i.duration_s)::bigint AS idle_sec
            FROM tracking.idle_periods i
            JOIN scope s ON s.vehicle_id = i.vehicle_id
            WHERE i.tenant_id = ?::uuid AND i.ended_at IS NOT NULL
              AND i.ended_at >= ? AND i.ended_at < ?
            GROUP BY i.vehicle_id
          ),
          parked AS (
            SELECT p.vehicle_id, SUM(p.duration_s)::bigint AS parking_sec
            FROM tracking.parking_periods p
            JOIN scope s ON s.vehicle_id = p.vehicle_id
            WHERE p.tenant_id = ?::uuid AND p.status = 'ENDED'
              AND p.ended_at >= ? AND p.ended_at < ?
            GROUP BY p.vehicle_id
          ),
          observed AS (
            SELECT pos.vehicle_id,
                   EXTRACT(EPOCH FROM (LEAST(?::timestamptz, MAX(pos.captured_at))
                                     - GREATEST(?::timestamptz, MIN(pos.captured_at))))::double precision AS observed_sec
            FROM tracking.vehicle_positions pos
            JOIN scope s ON s.vehicle_id = pos.vehicle_id
            WHERE pos.tenant_id = ?::uuid AND pos.quality = 1
              AND pos.captured_at >= ? AND pos.captured_at < ?
            GROUP BY pos.vehicle_id
          ),
          alarms AS (
            SELECT COUNT(*)::bigint AS total,
                   COUNT(*) FILTER (WHERE a.status = 'OPEN')::bigint AS open,
                   COUNT(*) FILTER (WHERE a.type = 'overspeed')::bigint AS speeding
            FROM notification.alerts a
            WHERE a.tenant_id = ?::uuid AND a.raised_at >= ? AND a.raised_at < ?
          ),
          geo AS (
            SELECT COUNT(*)::bigint AS total
            FROM notification.fleet_events fe
            WHERE fe.tenant_id = ?::uuid AND fe.event_type LIKE 'geofence.%'
              AND fe.occurred_at >= ? AND fe.occurred_at < ?
          )
          SELECT
            (SELECT COUNT(*) FROM scope)::bigint AS total_vehicles,
            (SELECT COUNT(*) FROM observed)::bigint AS with_telemetry,
            (SELECT COUNT(*) FROM moving)::bigint AS moving_vehicles,
            (SELECT COUNT(*) FROM idling)::bigint AS idle_vehicles,
            (SELECT COUNT(*) FROM parked)::bigint AS parked_vehicles,
            COALESCE((SELECT SUM(distance_km) FROM moving), 0) AS total_distance_km,
            COALESCE((SELECT SUM(trips) FROM moving), 0) AS total_trips,
            COALESCE((SELECT SUM(moving_sec) FROM moving), 0) AS moving_duration_sec,
            COALESCE((SELECT SUM(idle_sec) FROM idling), 0) AS idle_duration_sec,
            COALESCE((SELECT SUM(parking_sec) FROM parked), 0) AS parking_duration_sec,
            (SELECT MAX(max_speed_kmh) FROM moving) AS max_speed_kmh,
            COALESCE((SELECT total FROM discarded), 0) AS discarded_trips,
            COALESCE((SELECT total FROM alarms), 0) AS total_alarms,
            COALESCE((SELECT open FROM alarms), 0) AS open_alarms,
            COALESCE((SELECT speeding FROM alarms), 0) AS speeding_events,
            COALESCE((SELECT total FROM geo), 0) AS geofence_events,
            (SELECT AVG(m.moving_sec / o.observed_sec * 100) FROM moving m
              JOIN observed o ON o.vehicle_id = m.vehicle_id
              WHERE o.observed_sec > 0) AS avg_utilization
          `,
          [
            tenantId,
            ...vf.binds,
            tenantId,
            win.from,
            win.to,
            tenantId,
            win.from,
            win.to,
            tenantId,
            win.from,
            win.to,
            tenantId,
            win.from,
            win.to,
            win.to,
            win.from,
            tenantId,
            win.from,
            win.to,
            tenantId,
            win.from,
            win.to,
            tenantId,
            win.from,
            win.to,
          ],
        )
      ).rows as Record<string, unknown>[];
      const r = row ?? {};
      const total = Number(r.total_vehicles ?? 0);
      const withTel = Number(r.with_telemetry ?? 0);
      const movingSec = Number(r.moving_duration_sec ?? 0);
      const distanceKm = Number(r.total_distance_km ?? 0);
      // Avg speed = distance / moving-hours (KPI doc); null when no completed trips.
      const avgSpeedKmh = movingSec > 0 ? distanceKm / (movingSec / 3600) : null;
      const maxSpeedRaw = r.max_speed_kmh;
      return {
        totalVehicles: total,
        vehiclesWithTelemetry: withTel,
        noTelemetryVehicles: Math.max(0, total - withTel),
        movingVehicles: Number(r.moving_vehicles ?? 0),
        idleVehicles: Number(r.idle_vehicles ?? 0),
        parkedVehicles: Number(r.parked_vehicles ?? 0),
        totalDistanceKm: distanceKm,
        totalTrips: Number(r.total_trips ?? 0),
        totalAlarms: Number(r.total_alarms ?? 0),
        openAlarms: Number(r.open_alarms ?? 0),
        geofenceEvents: Number(r.geofence_events ?? 0),
        avgUtilizationPct: r.avg_utilization === null ? null : Number(r.avg_utilization),
        movingDurationSec: movingSec,
        idleDurationSec: Number(r.idle_duration_sec ?? 0),
        parkingDurationSec: Number(r.parking_duration_sec ?? 0),
        avgSpeedKmh,
        maxSpeedKmh: maxSpeedRaw === null || maxSpeedRaw === undefined ? null : Number(maxSpeedRaw),
        speedingEventCount: Number(r.speeding_events ?? 0),
        discardedTrips: Number(r.discarded_trips ?? 0),
      } satisfies FleetOverview;
    });
  }

  // ── Daily trend (§13 charts) ─────────────────────────────────────────────

  public async trend(
    tenantId: string,
    win: TimeWindow,
    filter: VehicleFilter,
  ): Promise<TrendPoint[]> {
    const vf = vehicleFilterSql(tenantId, 't', filter, 'vehicle_id');
    const alarmVehicleSql = filter.vehicleId ? ' AND a.vehicle_id = ?::uuid' : '';
    return this.query(async (trx) => {
      const rows = (
        await trx.raw(
          `
          WITH trip_days AS (
            SELECT time_bucket('1 day', t.started_at) AS day,
                   SUM(t.distance_km) AS distance_km, COUNT(*)::bigint AS trips
            FROM tracking.trip_events t
            WHERE t.tenant_id = ?::uuid AND t.status = 'COMPLETED'
              AND t.started_at >= ? AND t.started_at < ? ${vf.clause}
            GROUP BY 1
          ),
          alarm_days AS (
            SELECT time_bucket('1 day', a.raised_at) AS day, COUNT(*)::bigint AS alarms
            FROM notification.alerts a
            WHERE a.tenant_id = ?::uuid AND a.raised_at >= ? AND a.raised_at < ? ${alarmVehicleSql}
            GROUP BY 1
          )
          SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
                 COALESCE(td.distance_km, 0) AS distance_km,
                 COALESCE(td.trips, 0) AS trips,
                 COALESCE(ad.alarms, 0) AS alarms
          FROM (SELECT day FROM trip_days UNION SELECT day FROM alarm_days) d
          LEFT JOIN trip_days td ON td.day = d.day
          LEFT JOIN alarm_days ad ON ad.day = d.day
          ORDER BY d.day
          `,
          [
            tenantId,
            win.from,
            win.to,
            ...vf.binds,
            tenantId,
            win.from,
            win.to,
            ...(filter.vehicleId ? [filter.vehicleId] : []),
          ],
        )
      ).rows as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        day: String(r.day),
        distanceKm: Number(r.distance_km ?? 0),
        trips: Number(r.trips ?? 0),
        alarms: Number(r.alarms ?? 0),
      }));
    });
  }

  public async alarmTrend(
    tenantId: string,
    win: TimeWindow,
    filter: VehicleFilter,
  ): Promise<AlarmTrendPoint[]> {
    const vf = vehicleFilterSql(tenantId, 'a', filter, 'vehicle_id');
    return this.query(async (trx) => {
      const rows = (
        await trx.raw(
          `
          SELECT to_char(time_bucket('1 day', a.raised_at), 'YYYY-MM-DD') AS day,
            COUNT(*) FILTER (WHERE a.type = 'overspeed')::bigint AS speeding,
            COUNT(*) FILTER (WHERE a.type LIKE 'geofence_%')::bigint AS geofence,
            COUNT(*) FILTER (WHERE a.type = 'device_offline')::bigint AS offline,
            COUNT(*) FILTER (WHERE a.type NOT IN ('overspeed','device_offline')
                             AND a.type NOT LIKE 'geofence_%')::bigint AS other
          FROM notification.alerts a
          WHERE a.tenant_id = ?::uuid AND a.raised_at >= ? AND a.raised_at < ? ${vf.clause}
          GROUP BY 1 ORDER BY 1
          `,
          [tenantId, win.from, win.to, ...vf.binds],
        )
      ).rows as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        day: String(r.day),
        speeding: Number(r.speeding ?? 0),
        geofence: Number(r.geofence ?? 0),
        offline: Number(r.offline ?? 0),
        other: Number(r.other ?? 0),
      }));
    });
  }

  // ── Vehicle utilization (§7) ─────────────────────────────────────────────

  public async vehicleUtilization(
    tenantId: string,
    win: TimeWindow,
    filter: VehicleFilter,
    sort: { expression: string; direction: 'ASC' | 'DESC' },
    limit: number,
    offset: number,
  ): Promise<{ rows: VehicleUtilizationRow[]; total: number }> {
    const vf = vehicleFilterSql(tenantId, 'v', filter);
    return this.query(async (trx) => {
      const rows = (
        await trx.raw(
          `
          WITH moving AS (
            SELECT t.vehicle_id, SUM(t.duration_s)::bigint AS moving_sec,
                   SUM(t.distance_km) AS distance_km, COUNT(*)::bigint AS trips
            FROM tracking.trip_events t
            WHERE t.tenant_id = ?::uuid AND t.status = 'COMPLETED'
              AND t.started_at >= ? AND t.started_at < ?
            GROUP BY t.vehicle_id
          ),
          idling AS (
            SELECT i.vehicle_id, SUM(i.duration_s)::bigint AS idle_sec
            FROM tracking.idle_periods i
            WHERE i.tenant_id = ?::uuid AND i.ended_at >= ? AND i.ended_at < ?
            GROUP BY i.vehicle_id
          ),
          parking AS (
            SELECT p.vehicle_id, SUM(p.duration_s)::bigint AS parking_sec
            FROM tracking.parking_periods p
            WHERE p.tenant_id = ?::uuid AND p.status = 'ENDED'
              AND p.ended_at >= ? AND p.ended_at < ?
            GROUP BY p.vehicle_id
          ),
          observed AS (
            SELECT pos.vehicle_id,
                   EXTRACT(EPOCH FROM (LEAST(?::timestamptz, MAX(pos.captured_at))
                                     - GREATEST(?::timestamptz, MIN(pos.captured_at))))::double precision AS observed_sec
            FROM tracking.vehicle_positions pos
            WHERE pos.tenant_id = ?::uuid AND pos.quality = 1
              AND pos.captured_at >= ? AND pos.captured_at < ?
            GROUP BY pos.vehicle_id
          ),
          agg AS (
            SELECT v.id AS vehicle_id,
                   ${VEHICLE_LABEL_SQL} AS label,
                   COALESCE(m.moving_sec, 0) AS moving_sec,
                   COALESCE(i.idle_sec, 0) AS idle_sec,
                   COALESCE(p.parking_sec, 0) AS parking_sec,
                   o.observed_sec,
                   COALESCE(m.distance_km, 0) AS distance_km,
                   COALESCE(m.trips, 0) AS trips,
                   CASE WHEN o.observed_sec > 0
                        THEN ROUND((COALESCE(m.moving_sec, 0) / o.observed_sec * 100)::numeric, 1)
                        ELSE NULL END AS utilization_pct
            FROM fleet.vehicles v
            LEFT JOIN moving m ON m.vehicle_id = v.id
            LEFT JOIN idling i ON i.vehicle_id = v.id
            LEFT JOIN parking p ON p.vehicle_id = v.id
            LEFT JOIN observed o ON o.vehicle_id = v.id
            WHERE v.tenant_id = ?::uuid AND v.status = 'ACTIVE' ${vf.clause}
              AND (m.vehicle_id IS NOT NULL OR i.vehicle_id IS NOT NULL
                   OR p.vehicle_id IS NOT NULL OR o.vehicle_id IS NOT NULL)
          )
          SELECT agg.*, (SELECT COUNT(*) FROM agg)::bigint AS total_rows
          FROM agg
          ORDER BY ${sort.expression} ${sort.direction} NULLS LAST, agg.vehicle_id
          LIMIT ? OFFSET ?
          `,
          [
            tenantId,
            win.from,
            win.to,
            tenantId,
            win.from,
            win.to,
            tenantId,
            win.from,
            win.to,
            win.to,
            win.from,
            tenantId,
            win.from,
            win.to,
            tenantId,
            ...vf.binds,
            limit,
            offset,
          ],
        )
      ).rows as Array<Record<string, unknown>>;
      const total = rows.length > 0 ? Number(rows[0]?.total_rows ?? 0) : 0;
      return {
        total,
        rows: rows.map((r) => ({
          vehicleId: String(r.vehicle_id),
          label: String(r.label ?? r.vehicle_id),
          movingSec: Number(r.moving_sec ?? 0),
          idleSec: Number(r.idle_sec ?? 0),
          parkingSec: Number(r.parking_sec ?? 0),
          observedSec: r.observed_sec === null ? null : Number(r.observed_sec),
          utilizationPct: r.utilization_pct === null ? null : Number(r.utilization_pct),
          distanceKm: Number(r.distance_km ?? 0),
          trips: Number(r.trips ?? 0),
        })),
      };
    });
  }

  // ── Distance report (§8) ─────────────────────────────────────────────────

  public async distance(
    tenantId: string,
    win: TimeWindow,
    filter: VehicleFilter,
    limit: number,
    offset: number,
  ): Promise<{ rows: DistanceRow[]; total: number }> {
    const vf = vehicleFilterSql(tenantId, 'v', filter);
    return this.query(async (trx) => {
      const rows = (
        await trx.raw(
          `
          WITH trip_agg AS (
            SELECT t.vehicle_id, SUM(t.distance_km) AS distance_km, COUNT(*)::bigint AS trips,
                   MAX(t.distance_km) AS max_trip_km
            FROM tracking.trip_events t
            WHERE t.tenant_id = ?::uuid AND t.status = 'COMPLETED'
              AND t.started_at >= ? AND t.started_at < ?
            GROUP BY t.vehicle_id
          ),
          discarded AS (
            SELECT t.vehicle_id, COUNT(*)::bigint AS discarded
            FROM tracking.trip_events t
            WHERE t.tenant_id = ?::uuid AND t.status = 'DISCARDED'
              AND t.started_at >= ? AND t.started_at < ?
            GROUP BY t.vehicle_id
          ),
          agg AS (
            SELECT v.id AS vehicle_id,
                   ${VEHICLE_LABEL_SQL} AS label,
                   COALESCE(t.distance_km, 0) AS distance_km,
                   COALESCE(t.trips, 0) AS trips,
                   CASE WHEN COALESCE(t.trips, 0) > 0
                        THEN t.distance_km / t.trips ELSE NULL END AS avg_trip_km,
                   t.max_trip_km, COALESCE(d.discarded, 0) AS discarded_trips
            FROM fleet.vehicles v
            JOIN trip_agg t ON t.vehicle_id = v.id
            LEFT JOIN discarded d ON d.vehicle_id = v.id
            WHERE v.tenant_id = ?::uuid AND v.status = 'ACTIVE' ${vf.clause}
          )
          SELECT agg.*, (SELECT COUNT(*) FROM agg)::bigint AS total_rows
          FROM agg
          ORDER BY distance_km DESC, agg.vehicle_id
          LIMIT ? OFFSET ?
          `,
          [
            tenantId,
            win.from,
            win.to,
            tenantId,
            win.from,
            win.to,
            tenantId,
            ...vf.binds,
            limit,
            offset,
          ],
        )
      ).rows as Array<Record<string, unknown>>;
      const total = rows.length > 0 ? Number(rows[0]?.total_rows ?? 0) : 0;
      return {
        total,
        rows: rows.map((r) => ({
          vehicleId: String(r.vehicle_id),
          label: String(r.label ?? r.vehicle_id),
          distanceKm: Number(r.distance_km ?? 0),
          trips: Number(r.trips ?? 0),
          avgTripKm: r.avg_trip_km === null ? null : Number(r.avg_trip_km),
          maxTripKm: r.max_trip_km === null ? null : Number(r.max_trip_km),
          discardedTrips: Number(r.discarded_trips ?? 0),
        })),
      };
    });
  }

  // ── Trip report (§9) ─────────────────────────────────────────────────────

  public async trips(
    tenantId: string,
    win: TimeWindow,
    filter: VehicleFilter,
    sort: { expression: string; direction: 'ASC' | 'DESC' },
    limit: number,
    cursor: { startedAt: string; id: string } | null,
  ): Promise<{ rows: TripReportRow[]; nextCursor: { startedAt: string; id: string } | null }> {
    const vf = vehicleFilterSql(tenantId, 'v', filter);
    const cursorSql = cursor
      ? ' AND (t.started_at < ?::timestamptz OR (t.started_at = ?::timestamptz AND t.id < ?::uuid))'
      : '';
    const cursorBinds = cursor ? [cursor.startedAt, cursor.startedAt, cursor.id] : [];
    return this.query(async (trx) => {
      const rows = (
        await trx.raw(
          `
          SELECT t.id, t.vehicle_id,
                 COALESCE(${VEHICLE_LABEL_SQL}, LEFT(t.vehicle_id::text, 8)) AS label,
                 t.started_at, t.ended_at, t.duration_s, t.distance_km, t.max_speed_kmh,
                 t.start_lat, t.start_lng, t.end_lat, t.end_lng,
                 COALESCE((SELECT SUM(GREATEST(0, EXTRACT(EPOCH FROM
                     (LEAST(COALESCE(i.ended_at, ?::timestamptz), COALESCE(t.ended_at, ?::timestamptz)))
                    - GREATEST(i.started_at, t.started_at)))) FROM tracking.idle_periods i
                   WHERE i.tenant_id = ?::uuid AND i.vehicle_id = t.vehicle_id
                     AND i.started_at < COALESCE(t.ended_at, ?::timestamptz)
                     AND COALESCE(i.ended_at, ?::timestamptz) > t.started_at)::bigint, 0) AS idle_sec,
                 COALESCE((SELECT SUM(GREATEST(0, EXTRACT(EPOCH FROM
                     (LEAST(COALESCE(p.ended_at, ?::timestamptz), COALESCE(t.ended_at, ?::timestamptz)))
                    - GREATEST(p.started_at, t.started_at)))) FROM tracking.parking_periods p
                   WHERE p.tenant_id = ?::uuid AND p.vehicle_id = t.vehicle_id
                     AND p.started_at < COALESCE(t.ended_at, ?::timestamptz)
                     AND COALESCE(p.ended_at, ?::timestamptz) > t.started_at)::bigint, 0) AS parking_sec
          FROM tracking.trip_events t
          JOIN fleet.vehicles v ON v.id = t.vehicle_id
            AND v.tenant_id = ?::uuid AND v.status = 'ACTIVE' ${vf.clause}
          WHERE t.tenant_id = ?::uuid AND t.status = 'COMPLETED'
            AND t.started_at >= ? AND t.started_at < ? ${cursorSql}
          ORDER BY ${sort.expression} ${sort.direction} NULLS LAST, t.started_at DESC, t.id DESC
          LIMIT ?
          `,
          [
            // idle subquery: LEAST bounds (2) + tenant + overlap bounds (2)
            win.to,
            win.to,
            tenantId,
            win.to,
            win.to,
            // parking subquery: same shape
            win.to,
            win.to,
            tenantId,
            win.to,
            win.to,
            tenantId,
            ...vf.binds,
            tenantId,
            win.from,
            win.to,
            ...cursorBinds,
            limit + 1,
          ],
        )
      ).rows as Array<Record<string, unknown>>;
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      return {
        rows: page.map((r) => ({
          id: String(r.id),
          vehicleId: String(r.vehicle_id),
          label: String(r.label ?? r.vehicle_id),
          startedAt: new Date(r.started_at as string).toISOString(),
          endedAt: r.ended_at ? new Date(r.ended_at as string).toISOString() : null,
          durationSec: Number(r.duration_s ?? 0),
          distanceKm: Number(r.distance_km ?? 0),
          avgSpeedKph:
            Number(r.duration_s ?? 0) > 0
              ? Number((Number(r.distance_km) / (Number(r.duration_s) / 3600)).toFixed(2))
              : null,
          maxSpeedKph: Number(r.max_speed_kmh ?? 0),
          startLat: Number(r.start_lat),
          startLng: Number(r.start_lng),
          endLat: r.end_lat === null || r.end_lat === undefined ? null : Number(r.end_lat),
          endLng: r.end_lng === null || r.end_lng === undefined ? null : Number(r.end_lng),
          idleSec: Number(r.idle_sec ?? 0),
          parkingSec: Number(r.parking_sec ?? 0),
        })),
        nextCursor:
          hasMore && last
            ? {
                startedAt: new Date(last.started_at as string).toISOString(),
                id: String(last.id),
              }
            : null,
      };
    });
  }

  // ── Speed report (§10) ───────────────────────────────────────────────────

  public async speed(
    tenantId: string,
    win: TimeWindow,
    filter: VehicleFilter,
    limit: number,
    offset: number,
  ): Promise<{ rows: SpeedRow[]; total: number }> {
    const vf = vehicleFilterSql(tenantId, 'v', filter);
    return this.query(async (trx) => {
      const rows = (
        await trx.raw(
          `
          WITH trip_agg AS (
            SELECT t.vehicle_id, SUM(t.distance_km) AS distance_km,
                   SUM(t.duration_s)::bigint AS duration_s, MAX(t.max_speed_kmh) AS max_speed
            FROM tracking.trip_events t
            WHERE t.tenant_id = ?::uuid AND t.status = 'COMPLETED'
              AND t.started_at >= ? AND t.started_at < ?
            GROUP BY t.vehicle_id
          ),
          speeding AS (
            SELECT a.vehicle_id, COUNT(*)::bigint AS speeding
            FROM notification.alerts a
            WHERE a.tenant_id = ?::uuid AND a.type = 'overspeed'
              AND a.raised_at >= ? AND a.raised_at < ?
            GROUP BY a.vehicle_id
          ),
          agg AS (
            SELECT v.id AS vehicle_id,
                   ${VEHICLE_LABEL_SQL} AS label,
                   CASE WHEN COALESCE(ta.duration_s, 0) > 0
                        THEN ta.distance_km / (ta.duration_s / 3600.0) ELSE NULL END AS avg_speed,
                   ta.max_speed, COALESCE(s.speeding, 0) AS speeding
            FROM fleet.vehicles v
            LEFT JOIN trip_agg ta ON ta.vehicle_id = v.id
            LEFT JOIN speeding s ON s.vehicle_id = v.id
            WHERE v.tenant_id = ?::uuid AND v.status = 'ACTIVE' ${vf.clause}
              AND (ta.vehicle_id IS NOT NULL OR s.vehicle_id IS NOT NULL)
          )
          SELECT agg.*, (SELECT COUNT(*) FROM agg)::bigint AS total_rows
          FROM agg ORDER BY max_speed DESC NULLS LAST, agg.vehicle_id LIMIT ? OFFSET ?
          `,
          [
            tenantId,
            win.from,
            win.to,
            tenantId,
            win.from,
            win.to,
            tenantId,
            ...vf.binds,
            limit,
            offset,
          ],
        )
      ).rows as Array<Record<string, unknown>>;
      const total = rows.length > 0 ? Number(rows[0]?.total_rows ?? 0) : 0;
      return {
        total,
        rows: rows.map((r) => ({
          vehicleId: String(r.vehicle_id),
          label: String(r.label ?? r.vehicle_id),
          avgSpeedKph:
            r.avg_speed === null || r.avg_speed === undefined ? null : Number(r.avg_speed),
          maxSpeedKph:
            r.max_speed === null || r.max_speed === undefined ? null : Number(r.max_speed),
          speedingAlarms: Number(r.speeding ?? 0),
        })),
      };
    });
  }

  // ── Idle / parking report (§11) ─────────────────────────────────────────

  public async idleParking(
    tenantId: string,
    win: TimeWindow,
    filter: VehicleFilter,
    kind: 'IDLE' | 'PARKING' | undefined,
    limit: number,
    cursor: { startedAt: string; id: string } | null,
  ): Promise<{
    rows: ActivityPeriodRow[];
    nextCursor: { startedAt: string; id: string } | null;
  }> {
    const idleSelected = kind === undefined || kind === 'IDLE';
    const parkingSelected = kind === undefined || kind === 'PARKING';
    const parts: string[] = [];
    const vf = vehicleFilterSql(tenantId, 'v', filter);
    if (idleSelected) {
      parts.push(`
        SELECT i.id, 'IDLE' AS kind, i.vehicle_id,
               COALESCE(${VEHICLE_LABEL_SQL}, LEFT(i.vehicle_id::text, 8)) AS label,
               i.started_at, i.ended_at, i.duration_s, NULL::double precision AS lat, NULL::double precision AS lng,
               NULL::text AS status
        FROM tracking.idle_periods i
        JOIN fleet.vehicles v ON v.id = i.vehicle_id AND v.tenant_id = ?::uuid AND v.status = 'ACTIVE' ${vf.clause}
        WHERE i.tenant_id = ?::uuid AND i.started_at >= ? AND i.started_at < ?`);
    }
    if (parkingSelected) {
      parts.push(`
        SELECT p.id, 'PARKING' AS kind, p.vehicle_id,
               COALESCE(${VEHICLE_LABEL_SQL}, LEFT(p.vehicle_id::text, 8)) AS label,
               p.started_at, p.ended_at, p.duration_s, p.lat, p.lng, p.status
        FROM tracking.parking_periods p
        JOIN fleet.vehicles v ON v.id = p.vehicle_id AND v.tenant_id = ?::uuid AND v.status = 'ACTIVE' ${vf.clause}
        WHERE p.tenant_id = ?::uuid AND p.started_at >= ? AND p.started_at < ?`);
    }
    const perSourceBinds = [tenantId, ...vf.binds, tenantId, win.from, win.to];
    const cursorSql = cursor
      ? ' WHERE started_at < ?::timestamptz OR (started_at = ?::timestamptz AND id < ?::uuid)'
      : '';
    const cursorBinds = cursor ? [cursor.startedAt, cursor.startedAt, cursor.id] : [];
    return this.query(async (trx) => {
      const rows = (
        await trx.raw(
          `
          SELECT * FROM (${parts.join(' UNION ALL ')}) u ${cursorSql}
          ORDER BY started_at DESC, id DESC LIMIT ?
          `,
          [
            ...Array.from({ length: parts.length }, () => perSourceBinds).flat(),
            ...cursorBinds,
            limit + 1,
          ],
        )
      ).rows as Array<Record<string, unknown>>;
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      return {
        rows: page.map((r) => ({
          id: String(r.id),
          kind: String(r.kind) as 'IDLE' | 'PARKING',
          vehicleId: String(r.vehicle_id),
          label: String(r.label ?? r.vehicle_id),
          startedAt: new Date(r.started_at as string).toISOString(),
          endedAt: r.ended_at ? new Date(r.ended_at as string).toISOString() : null,
          durationSec: Number(r.duration_s ?? 0),
          lat: r.lat === null || r.lat === undefined ? null : Number(r.lat),
          lng: r.lng === null || r.lng === undefined ? null : Number(r.lng),
          status: r.status ? String(r.status) : null,
        })),
        nextCursor:
          hasMore && last
            ? { startedAt: new Date(last.started_at as string).toISOString(), id: String(last.id) }
            : null,
      };
    });
  }

  // ── Alarm report (§12) ──────────────────────────────────────────────────

  public async alarms(
    tenantId: string,
    win: TimeWindow,
    opts: {
      vehicleId?: string;
      fleetId?: string;
      type?: string;
      severity?: string;
    },
    limit: number,
    offset: number,
  ): Promise<{ rows: AlarmAggregateRow[]; total: number; summary: Record<string, number> }> {
    const conditions = ['a.tenant_id = ?::uuid', 'a.raised_at >= ?', 'a.raised_at < ?'];
    const binds: unknown[] = [tenantId, win.from, win.to];
    if (opts.vehicleId) {
      conditions.push('a.vehicle_id = ?::uuid');
      binds.push(opts.vehicleId);
    } else if (opts.fleetId) {
      conditions.push(
        'EXISTS (SELECT 1 FROM fleet.vehicles fv WHERE fv.id = a.vehicle_id AND fv.tenant_id = ?::uuid AND fv.fleet_id = ?::uuid)',
      );
      binds.push(tenantId, opts.fleetId);
    }
    if (opts.type) {
      conditions.push('a.type = ?');
      binds.push(opts.type);
    }
    if (opts.severity) {
      conditions.push('a.severity = ?');
      binds.push(opts.severity);
    }
    const where = conditions.join(' AND ');
    return this.query(async (trx) => {
      const rows = (
        await trx.raw(
          `
          WITH scoped AS (SELECT a.* FROM notification.alerts a WHERE ${where})
          SELECT s.vehicle_id,
                 COALESCE(${VEHICLE_LABEL_SQL}, LEFT(s.vehicle_id::text, 8)) AS label,
                 s.type, s.severity,
                 COUNT(*)::bigint AS total,
                 COUNT(*) FILTER (WHERE s.status = 'OPEN')::bigint AS open,
                 COUNT(*) FILTER (WHERE s.status = 'ACKNOWLEDGED')::bigint AS acknowledged,
                 COUNT(*) FILTER (WHERE s.status = 'RESOLVED')::bigint AS resolved
          FROM scoped s
          LEFT JOIN fleet.vehicles v ON v.id = s.vehicle_id AND v.tenant_id = ?::uuid
          GROUP BY s.vehicle_id, v.plate, v.name, v.code, s.type, s.severity
          ORDER BY total DESC, s.type
          LIMIT ? OFFSET ?
          `,
          [...binds, tenantId, limit, offset],
        )
      ).rows as Array<Record<string, unknown>>;
      const [summaryRow] = (
        await trx.raw(
          `SELECT COUNT(*)::bigint AS total,
                  COUNT(*) FILTER (WHERE status = 'OPEN')::bigint AS open,
                  COUNT(*) FILTER (WHERE status = 'ACKNOWLEDGED')::bigint AS acknowledged,
                  COUNT(*) FILTER (WHERE status = 'RESOLVED')::bigint AS resolved,
                  COUNT(*) FILTER (WHERE severity = 'CRITICAL')::bigint AS critical,
                  COUNT(*) FILTER (WHERE severity = 'HIGH')::bigint AS high,
                  COUNT(*) FILTER (WHERE severity = 'MEDIUM')::bigint AS medium,
                  COUNT(*) FILTER (WHERE severity = 'LOW')::bigint AS low,
                  COUNT(*) FILTER (WHERE severity = 'INFO')::bigint AS info
           FROM notification.alerts a WHERE ${where}`,
          binds,
        )
      ).rows as Array<Record<string, unknown>>;
      const s = summaryRow ?? {};
      const total = Number(s.total ?? 0);
      const groupTotal = rows.reduce((acc, r) => acc + Number(r.total ?? 0), 0);
      return {
        total,
        rows: rows.map((r) => ({
          vehicleId: r.vehicle_id ? String(r.vehicle_id) : null,
          label: r.label ? String(r.label) : null,
          type: String(r.type),
          severity: String(r.severity),
          total: Number(r.total ?? 0),
          open: Number(r.open ?? 0),
          acknowledged: Number(r.acknowledged ?? 0),
          resolved: Number(r.resolved ?? 0),
        })),
        summary: {
          total,
          open: Number(s.open ?? 0),
          acknowledged: Number(s.acknowledged ?? 0),
          resolved: Number(s.resolved ?? 0),
          critical: Number(s.critical ?? 0),
          high: Number(s.high ?? 0),
          medium: Number(s.medium ?? 0),
          low: Number(s.low ?? 0),
          info: Number(s.info ?? 0),
          groupsTruncated: Math.max(0, total - groupTotal),
        },
      };
    });
  }

  // ── Geofence report (§14) ───────────────────────────────────────────────

  public async geofenceReport(
    tenantId: string,
    win: TimeWindow,
    opts: { geofenceId?: string; vehicleId?: string },
    limit: number,
    offset: number,
  ): Promise<{ rows: GeofenceReportRow[]; total: number }> {
    const conditions = [
      'fe.tenant_id = ?::uuid',
      "fe.event_type LIKE 'geofence.%'",
      'fe.occurred_at >= ?',
      'fe.occurred_at < ?',
    ];
    const binds: unknown[] = [tenantId, win.from, win.to];
    if (opts.geofenceId) {
      conditions.push("fe.metadata->>'geofenceId' = ?");
      binds.push(opts.geofenceId);
    }
    if (opts.vehicleId) {
      conditions.push('fe.vehicle_id = ?::uuid');
      binds.push(opts.vehicleId);
    }
    return this.query(async (trx) => {
      const rows = (
        await trx.raw(
          `
          WITH geo_events AS (
            SELECT fe.*, fe.metadata->>'geofenceId' AS gf_id
            FROM notification.fleet_events fe WHERE ${conditions.join(' AND ')}
          ),
          agg AS (
            SELECT g.gf_id AS geofence_id,
                   MAX(COALESCE(gf.name, g.metadata->>'geofenceName')) AS geofence_name,
                   g.vehicle_id,
                   COUNT(*) FILTER (WHERE g.event_type = 'geofence.entered')::bigint AS enters,
                   COUNT(*) FILTER (WHERE g.event_type = 'geofence.exited')::bigint AS exits,
                   COUNT(*) FILTER (WHERE g.event_type = 'geofence.dwell')::bigint AS dwells,
                   COALESCE(SUM(CASE WHEN g.event_type = 'geofence.exited'
                        THEN COALESCE((g.metadata->>'dwellSec')::numeric, 0) ELSE 0 END), 0) AS time_inside_sec
            FROM geo_events g
            LEFT JOIN tracking.geofences gf ON gf.id = g.gf_id::uuid AND gf.tenant_id = ?::uuid
            GROUP BY g.gf_id, g.vehicle_id
          )
          SELECT a.*,
                 ${VEHICLE_LABEL_SQL} AS label,
                 (SELECT COUNT(*) FROM agg)::bigint AS total_rows
          FROM agg a
          LEFT JOIN fleet.vehicles v ON v.id = a.vehicle_id AND v.tenant_id = ?::uuid
          ORDER BY enters + exits DESC, a.geofence_id
          LIMIT ? OFFSET ?
          `,
          [...binds, tenantId, tenantId, limit, offset],
        )
      ).rows as Array<Record<string, unknown>>;
      const total = rows.length > 0 ? Number(rows[0]?.total_rows ?? 0) : 0;
      return {
        total,
        rows: rows.map((r) => ({
          geofenceId: r.geofence_id ? String(r.geofence_id) : null,
          geofenceName: r.geofence_name ? String(r.geofence_name) : null,
          vehicleId: r.vehicle_id ? String(r.vehicle_id) : null,
          label: r.label ? String(r.label) : null,
          enters: Number(r.enters ?? 0),
          exits: Number(r.exits ?? 0),
          dwells: Number(r.dwells ?? 0),
          timeInsideSec: Number(r.time_inside_sec ?? 0),
        })),
      };
    });
  }

  // ── Activity timeline (§15) ─────────────────────────────────────────────

  public async activity(
    tenantId: string,
    win: TimeWindow,
    opts: { vehicleId?: string },
    limit: number,
    cursor: { at: string; id: string } | null,
  ): Promise<{ rows: ActivityEvent[]; nextCursor: { at: string; id: string } | null }> {
    const vehicleSql = opts.vehicleId ? ' AND x.vehicle_id = ?::uuid' : '';
    const cursorSql = cursor
      ? ' WHERE x.at < ?::timestamptz OR (x.at = ?::timestamptz AND x.id < ?)'
      : '';
    const cursorBinds = cursor ? [cursor.at, cursor.at, cursor.id] : [];
    return this.query(async (trx) => {
      const rows = (
        await trx.raw(
          `
          WITH u AS (
            SELECT t.started_at AS at, 'gps-engine.trips' AS source,
                   'TRIP_STARTED' AS kind, t.vehicle_id, t.id::text AS id,
                   'distance ' || ROUND(t.distance_km::numeric, 1) || ' km' AS detail
            FROM tracking.trip_events t
            WHERE t.tenant_id = ?::uuid AND t.started_at >= ? AND t.started_at < ?
            UNION ALL
            SELECT t.ended_at, 'gps-engine.trips', 'TRIP_ENDED', t.vehicle_id, 'e' || t.id::text,
                   'distance ' || ROUND(t.distance_km::numeric, 1) || ' km'
            FROM tracking.trip_events t
            WHERE t.tenant_id = ?::uuid AND t.ended_at IS NOT NULL
              AND t.ended_at >= ? AND t.ended_at < ?
            UNION ALL
            SELECT i.started_at, 'gps-engine.idle', 'IDLE', i.vehicle_id, i.id::text,
                   'idle ' || i.duration_s || 's'
            FROM tracking.idle_periods i
            WHERE i.tenant_id = ?::uuid AND i.started_at >= ? AND i.started_at < ?
            UNION ALL
            SELECT p.started_at, 'gps-engine.parking', 'PARKING', p.vehicle_id, p.id::text,
                   'parking ' || p.duration_s || 's'
            FROM tracking.parking_periods p
            WHERE p.tenant_id = ?::uuid AND p.started_at >= ? AND p.started_at < ?
            UNION ALL
            SELECT fe.occurred_at, 'notification.fleet_events',
                   CASE fe.event_type
                     WHEN 'geofence.entered' THEN 'GEOFENCE_ENTER'
                     WHEN 'geofence.exited' THEN 'GEOFENCE_EXIT'
                     WHEN 'geofence.dwell' THEN 'GEOFENCE_DWELL' END,
                   fe.vehicle_id, 'f' || fe.id,
                   COALESCE(fe.metadata->>'geofenceName', fe.metadata->>'geofenceId')
            FROM notification.fleet_events fe
            WHERE fe.tenant_id = ?::uuid AND fe.event_type LIKE 'geofence.%'
              AND fe.occurred_at >= ? AND fe.occurred_at < ?
            UNION ALL
            SELECT a.raised_at, 'notification.alerts', 'ALARM', a.vehicle_id, 'a' || a.id::text,
                   a.type || ' · ' || a.severity
            FROM notification.alerts a
            WHERE a.tenant_id = ?::uuid AND a.raised_at >= ? AND a.raised_at < ?
          ), x AS (SELECT * FROM u WHERE vehicle_id IS NOT NULL ${vehicleSql ? 'AND u.vehicle_id = ?::uuid' : ''})
          SELECT x.at, x.source, x.kind, x.vehicle_id, x.id AS cursor_id,
                 COALESCE(${VEHICLE_LABEL_SQL}, LEFT(x.vehicle_id::text, 8)) AS label,
                 x.detail
          FROM x JOIN fleet.vehicles v ON v.id = x.vehicle_id AND v.tenant_id = ?::uuid
          ${cursorSql}
          ORDER BY x.at DESC, x.id DESC
          LIMIT ?
          `,
          [
            tenantId,
            win.from,
            win.to,
            tenantId,
            win.from,
            win.to,
            tenantId,
            win.from,
            win.to,
            tenantId,
            win.from,
            win.to,
            tenantId,
            win.from,
            win.to,
            tenantId,
            win.from,
            win.to,
            ...(opts.vehicleId ? [opts.vehicleId] : []),
            tenantId,
            ...cursorBinds,
            limit + 1,
          ],
        )
      ).rows as Array<Record<string, unknown>>;
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      return {
        rows: page.map((r) => ({
          at: new Date(r.at as string).toISOString(),
          source: String(r.source) as ActivityEvent['source'],
          kind: String(r.kind) as ActivityEvent['kind'],
          vehicleId: r.vehicle_id ? String(r.vehicle_id) : null,
          label: r.label ? String(r.label) : null,
          detail: r.detail ? String(r.detail) : null,
        })),
        nextCursor:
          hasMore && last
            ? { at: new Date(last.at as string).toISOString(), id: String(last.cursor_id) }
            : null,
      };
    });
  }

  // ── Fleet comparison (Reporting.md §1.3 Executive) ───────────────────────

  public async fleetComparison(tenantId: string, win: TimeWindow): Promise<FleetComparisonRow[]> {
    return this.query(async (trx) => {
      const { rows } = await trx.raw(
        `
        WITH scope AS (
          SELECT v.id AS vehicle_id, v.fleet_id,
                 COALESCE(f.name, f.code, 'Unassigned') AS fleet_name
          FROM fleet.vehicles v
          LEFT JOIN fleet.fleets f ON f.id = v.fleet_id AND f.tenant_id = v.tenant_id
          WHERE v.tenant_id = ?::uuid AND v.status = 'ACTIVE'
        ),
        moving AS (
          SELECT s.fleet_id,
                 SUM(t.duration_s)::bigint AS moving_sec,
                 SUM(t.distance_km) AS distance_km,
                 COUNT(*)::bigint AS trips
          FROM tracking.trip_events t
          JOIN scope s ON s.vehicle_id = t.vehicle_id
          WHERE t.tenant_id = ?::uuid AND t.status = 'COMPLETED'
            AND t.started_at >= ? AND t.started_at < ?
          GROUP BY s.fleet_id
        ),
        observed_vehicle AS (
          SELECT s.fleet_id, pos.vehicle_id,
                 EXTRACT(EPOCH FROM (LEAST(?::timestamptz, MAX(pos.captured_at))
                                   - GREATEST(?::timestamptz, MIN(pos.captured_at))))::double precision AS observed_sec
          FROM tracking.vehicle_positions pos
          JOIN scope s ON s.vehicle_id = pos.vehicle_id
          WHERE pos.tenant_id = ?::uuid AND pos.quality = 1
            AND pos.captured_at >= ? AND pos.captured_at < ?
          GROUP BY s.fleet_id, pos.vehicle_id
        ),
        observed_fleet AS (
          SELECT fleet_id, SUM(observed_sec) AS observed_sec
          FROM observed_vehicle
          GROUP BY fleet_id
        ),
        alarms AS (
          SELECT v.fleet_id, COUNT(*)::bigint AS total
          FROM notification.alerts a
          JOIN fleet.vehicles v ON v.id = a.vehicle_id AND v.tenant_id = a.tenant_id
          WHERE a.tenant_id = ?::uuid AND a.raised_at >= ? AND a.raised_at < ?
          GROUP BY v.fleet_id
        )
        SELECT
          s.fleet_id,
          MAX(s.fleet_name) AS fleet_name,
          COUNT(*)::bigint AS vehicle_count,
          COALESCE(MAX(m.distance_km), 0) AS distance_km,
          COALESCE(MAX(m.trips), 0) AS trips,
          COALESCE(MAX(m.moving_sec), 0) AS moving_duration_sec,
          CASE WHEN COALESCE(MAX(o.observed_sec), 0) > 0
            THEN MAX(m.moving_sec)::double precision / MAX(o.observed_sec) * 100
            ELSE NULL END AS utilization_pct,
          COALESCE(MAX(a.total), 0) AS alarms
        FROM scope s
        LEFT JOIN moving m ON m.fleet_id IS NOT DISTINCT FROM s.fleet_id
        LEFT JOIN observed_fleet o ON o.fleet_id IS NOT DISTINCT FROM s.fleet_id
        LEFT JOIN alarms a ON a.fleet_id IS NOT DISTINCT FROM s.fleet_id
        GROUP BY s.fleet_id
        ORDER BY COALESCE(MAX(m.distance_km), 0) DESC
        `,
        [
          tenantId,
          tenantId,
          win.from,
          win.to,
          win.to,
          win.from,
          tenantId,
          win.from,
          win.to,
          tenantId,
          win.from,
          win.to,
        ],
      );
      return (rows as Record<string, unknown>[]).map((r) => ({
        fleetId: r.fleet_id ? String(r.fleet_id) : null,
        fleetName: String(r.fleet_name ?? 'Unassigned'),
        vehicleCount: Number(r.vehicle_count ?? 0),
        distanceKm: Number(r.distance_km ?? 0),
        trips: Number(r.trips ?? 0),
        movingDurationSec: Number(r.moving_duration_sec ?? 0),
        utilizationPct:
          r.utilization_pct === null || r.utilization_pct === undefined
            ? null
            : Number(r.utilization_pct),
        alarms: Number(r.alarms ?? 0),
      }));
    });
  }

  /** Alarm-engine safety counts for a window (no composite score — counts only). */
  public async safetyCounts(
    tenantId: string,
    win: TimeWindow,
  ): Promise<Omit<SafetyScorecard, 'previous'>> {
    return this.query(async (trx) => {
      const [{ rows: alarmRows }, { rows: geoRows }] = await Promise.all([
        trx.raw(
          `
          SELECT
            COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE a.status = 'OPEN')::bigint AS open,
            COUNT(*) FILTER (WHERE a.type = 'overspeed')::bigint AS speeding,
            COUNT(*) FILTER (WHERE a.severity IN ('HIGH', 'CRITICAL'))::bigint AS high_severity
          FROM notification.alerts a
          WHERE a.tenant_id = ?::uuid AND a.raised_at >= ? AND a.raised_at < ?
          `,
          [tenantId, win.from, win.to],
        ),
        trx.raw(
          `
          SELECT COUNT(*)::bigint AS total
          FROM notification.fleet_events fe
          WHERE fe.tenant_id = ?::uuid AND fe.event_type LIKE 'geofence.%'
            AND fe.occurred_at >= ? AND fe.occurred_at < ?
          `,
          [tenantId, win.from, win.to],
        ),
      ]);
      const a = (alarmRows as Record<string, unknown>[])[0] ?? {};
      const g = (geoRows as Record<string, unknown>[])[0] ?? {};
      return {
        totalAlarms: Number(a.total ?? 0),
        openAlarms: Number(a.open ?? 0),
        speedingEvents: Number(a.speeding ?? 0),
        highSeverityAlarms: Number(a.high_severity ?? 0),
        geofenceEvents: Number(g.total ?? 0),
      };
    });
  }
}

/** Build the shared vehicle-filter fragment (pure — tenant bound explicitly).
 * `alias` is the vehicles-table alias ('v') or a vehicle_id-bearing table for
 * EXISTS-based fleet scoping. */
function vehicleFilterSql(
  tenantId: string,
  alias: 'v' | 't' | 'a',
  filter: VehicleFilter,
  vehicleColumn?: 'vehicle_id',
): { clause: string; binds: unknown[] } {
  const binds: unknown[] = [];
  const clauses: string[] = [];
  if (filter.vehicleId) {
    if (alias === 'v') {
      clauses.push('v.id = ?::uuid');
    } else if (vehicleColumn) {
      clauses.push(`${alias}.${vehicleColumn} = ?::uuid`);
    }
    binds.push(filter.vehicleId);
  }
  if (filter.fleetId) {
    if (alias === 'v') {
      clauses.push('v.fleet_id = ?::uuid');
      binds.push(filter.fleetId);
    } else if (vehicleColumn) {
      clauses.push(
        `EXISTS (SELECT 1 FROM fleet.vehicles fv WHERE fv.id = ${alias}.${vehicleColumn} AND fv.tenant_id = ?::uuid AND fv.fleet_id = ?::uuid)`,
      );
      binds.push(tenantId, filter.fleetId);
    }
  }
  return { clause: clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '', binds };
}

export { UUID_RE };
