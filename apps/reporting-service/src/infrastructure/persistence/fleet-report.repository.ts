/**
 * FleetReportRepository — READ-ONLY SQL behind the fleet-wide tabular reports
 * (high speeds, mileage, temperature out of range).
 *
 * Same rules as ReportRepository: tenant AND time constrain every scan,
 * parameters are bound, and each query runs in a READ ONLY transaction with a
 * statement timeout.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import {
  type MileageVehicleRow,
  type ObjectStatusRow,
  TEMP_GAP_SEC,
  TEMP_PLAUSIBLE_MAX_C,
  TEMP_PLAUSIBLE_MIN_C,
  type TemperatureBounds,
  type TemperatureSensorStat,
  type VehicleRef,
} from '../../domain/fleet-reports.js';
import {
  MAX_PLAUSIBLE_KMH,
  type SpeedFix,
  TRACK_WINDOW_SEC,
} from '../../domain/speeding-events.js';
import type { TimeWindow, VehicleFilter } from './report.repository.js';

/** "name · plate" when both exist; otherwise name, plate, or code. */
const VEHICLE_LABEL_SQL = `CASE
  WHEN NULLIF(BTRIM(v.name), '') IS NOT NULL
   AND NULLIF(BTRIM(v.plate), '') IS NOT NULL
   AND BTRIM(v.name) IS DISTINCT FROM BTRIM(v.plate)
    THEN BTRIM(v.name) || ' · ' || BTRIM(v.plate)
  ELSE COALESCE(NULLIF(BTRIM(v.name), ''), NULLIF(BTRIM(v.plate), ''), NULLIF(BTRIM(v.code), ''), v.id::text)
END`;

export interface FleetOverspeedData {
  readonly vehicles: readonly VehicleRef[];
  readonly fixes: ReadonlyMap<string, readonly SpeedFix[]>;
  readonly context: ReadonlyMap<string, readonly SpeedFix[]>;
  /** More over-limit fixes exist than were read. */
  readonly truncated: boolean;
}

/** One out-of-range period as the database computed it (before numbering). */
export interface TemperatureEpisodeDbRow {
  readonly vehicleId: string;
  readonly sensor: string;
  readonly kind: 'HIGH' | 'LOW';
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly minC: number;
  readonly maxC: number;
  readonly avgC: number;
  readonly readings: number;
  readonly startLat: number;
  readonly startLng: number;
}

export interface TemperatureData {
  readonly vehicles: readonly VehicleRef[];
  readonly episodes: readonly TemperatureEpisodeDbRow[];
  readonly sensors: readonly TemperatureSensorStat[];
  readonly truncated: boolean;
}

export class FleetReportRepository {
  constructor(private readonly deps: { knex: Knex; queryTimeoutMs: number }) {}

  private async query<T>(fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    return this.deps.knex.transaction(async (trx) => {
      await trx.raw('SET LOCAL TRANSACTION READ ONLY');
      await trx.raw(`SET LOCAL statement_timeout = '${Math.floor(this.deps.queryTimeoutMs)}'`);
      return fn(trx);
    });
  }

  /** Active vehicles in scope, with label and fleet name. */
  private async vehicles(
    trx: Knex.Transaction,
    tenantId: string,
    filter: VehicleFilter,
  ): Promise<VehicleRef[]> {
    const vf = vehicleFilter(filter);
    const rows = (
      await trx.raw(
        `SELECT v.id, ${VEHICLE_LABEL_SQL} AS label, f.name AS fleet_name
         FROM fleet.vehicles v
         LEFT JOIN fleet.fleets f ON f.id = v.fleet_id AND f.tenant_id = v.tenant_id
         WHERE v.tenant_id = ?::uuid AND v.status = 'ACTIVE' ${vf.clause}`,
        [tenantId, ...vf.binds],
      )
    ).rows as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      vehicleId: String(r.id),
      label: String(r.label ?? r.id),
      fleetName: r.fleet_name === null || r.fleet_name === undefined ? null : String(r.fleet_name),
    }));
  }

  // ── High speeds ────────────────────────────────────────────────────────────

  /**
   * Over-limit GPS fixes of every vehicle in scope, plus the VALID fixes around
   * them (any speed) that the plausibility screen judges them against.
   */
  public async overspeedFixes(
    tenantId: string,
    win: TimeWindow,
    filter: VehicleFilter,
    limitKmh: number,
    fixCap: number,
  ): Promise<FleetOverspeedData> {
    return this.query(async (trx) => {
      const vehicles = await this.vehicles(trx, tenantId, filter);
      if (vehicles.length === 0) {
        return { vehicles, fixes: new Map(), context: new Map(), truncated: false };
      }
      const ids = vehicles.map((v) => v.vehicleId);
      const rows = (
        await trx.raw(
          `SELECT p.vehicle_id, p.captured_at, p.latitude, p.longitude, p.speed_kmh
           FROM tracking.vehicle_positions p
           WHERE p.tenant_id = ?::uuid AND p.vehicle_id = ANY(?::uuid[])
             AND p.quality IN (1, 3)
             AND p.captured_at >= ? AND p.captured_at < ?
             AND p.speed_kmh > ? AND p.speed_kmh <= ?
           ORDER BY p.vehicle_id, p.captured_at
           LIMIT ?`,
          [tenantId, ids, win.from, win.to, limitKmh, MAX_PLAUSIBLE_KMH, fixCap + 1],
        )
      ).rows as Array<Record<string, unknown>>;
      const truncated = rows.length > fixCap;
      const fixes = groupFixes(rows.slice(0, fixCap));

      // ±TRACK_WINDOW_SEC around each over-limit fix, merged per vehicle.
      const spanVehicle: string[] = [];
      const spanFrom: string[] = [];
      const spanTo: string[] = [];
      const pad = TRACK_WINDOW_SEC * 1000;
      for (const [vehicleId, list] of fixes) {
        let cur: { from: number; to: number } | null = null;
        const flush = () => {
          if (!cur) return;
          spanVehicle.push(vehicleId);
          spanFrom.push(new Date(cur.from).toISOString());
          spanTo.push(new Date(cur.to).toISOString());
        };
        for (const f of list) {
          const from = f.at.getTime() - pad;
          const to = f.at.getTime() + pad;
          if (cur && from <= cur.to) cur.to = Math.max(cur.to, to);
          else {
            flush();
            cur = { from, to };
          }
        }
        flush();
      }
      const contextRows =
        spanVehicle.length === 0
          ? []
          : ((
              await trx.raw(
                `SELECT DISTINCT ON (p.vehicle_id, p.captured_at)
                        p.vehicle_id, p.captured_at, p.latitude, p.longitude, p.speed_kmh
                 FROM unnest(?::uuid[], ?::timestamptz[], ?::timestamptz[]) AS w(vid, s, e)
                 JOIN tracking.vehicle_positions p
                   ON p.tenant_id = ?::uuid AND p.vehicle_id = w.vid AND p.quality = 1
                  AND p.captured_at BETWEEN w.s AND w.e
                 ORDER BY p.vehicle_id, p.captured_at`,
                [spanVehicle, spanFrom, spanTo, tenantId],
              )
            ).rows as Array<Record<string, unknown>>);
      return { vehicles, fixes, context: groupFixes(contextRows), truncated };
    });
  }

  // ── Mileage ────────────────────────────────────────────────────────────────

  /**
   * Kilometres per active vehicle: the GPS engine's COMPLETED trips that
   * started in the window (the same source as the distance report and the
   * fleet overview). Vehicles with no trip come back with 0.
   */
  public async mileage(
    tenantId: string,
    win: TimeWindow,
    filter: VehicleFilter,
  ): Promise<MileageVehicleRow[]> {
    const vf = vehicleFilter(filter);
    return this.query(async (trx) => {
      const rows = (
        await trx.raw(
          `WITH trip_agg AS (
             SELECT t.vehicle_id, SUM(t.distance_km) AS distance_km, COUNT(*)::bigint AS trips
             FROM tracking.trip_events t
             WHERE t.tenant_id = ?::uuid AND t.status = 'COMPLETED'
               AND t.started_at >= ? AND t.started_at < ?
             GROUP BY t.vehicle_id
           )
           SELECT v.id, ${VEHICLE_LABEL_SQL} AS label, v.fleet_id, f.name AS fleet_name,
                  COALESCE(ta.distance_km, 0) AS distance_km, COALESCE(ta.trips, 0) AS trips
           FROM fleet.vehicles v
           LEFT JOIN fleet.fleets f ON f.id = v.fleet_id AND f.tenant_id = v.tenant_id
           LEFT JOIN trip_agg ta ON ta.vehicle_id = v.id
           WHERE v.tenant_id = ?::uuid AND v.status = 'ACTIVE' ${vf.clause}`,
          [tenantId, win.from, win.to, tenantId, ...vf.binds],
        )
      ).rows as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        vehicleId: String(r.id),
        label: String(r.label ?? r.id),
        fleetId: r.fleet_id ? String(r.fleet_id) : null,
        fleetName: r.fleet_name ? String(r.fleet_name) : null,
        distanceKm: Number(r.distance_km ?? 0),
        trips: Number(r.trips ?? 0),
      }));
    });
  }

  // ── Temperature ────────────────────────────────────────────────────────────

  /**
   * Periods each cargo / fridge probe read outside the allowed band, computed
   * in the database (gaps-and-islands over every reading of every probe):
   *
   *   - readings: Meitrack CCE temperature slots (`metadata.cce.status.temperatures`)
   *     and the Teltonika probes the GPS engine stores (`metadata.temps`);
   *     sensor-fault values outside [-55, 85) °C are dropped, and the vehicle's
   *     temperature offset (legacy "شیفت دما", fleet.vehicles.temperature_offset_c) is added;
   *   - a period is a run of consecutive readings on the same side of the band
   *     (HIGH / LOW); a reading gap over TEMP_GAP_SEC also ends it.
   *   - it ends at the first reading back in range (when one follows within the
   *     gap), otherwise at its last out-of-range reading.
   */
  public async temperature(
    tenantId: string,
    win: TimeWindow,
    filter: VehicleFilter,
    bounds: TemperatureBounds,
    minDurationSec: number,
    episodeCap: number,
  ): Promise<TemperatureData> {
    return this.query(async (trx) => {
      const vehicles = await this.vehicles(trx, tenantId, filter);
      if (vehicles.length === 0) return { vehicles, episodes: [], sensors: [], truncated: false };
      const ids = vehicles.map((v) => v.vehicleId);
      const result = (
        await trx.raw(
          `WITH raw AS (
             SELECT p.vehicle_id, p.captured_at AS at, p.latitude AS lat, p.longitude AS lng,
                    p.metadata, COALESCE(v.temperature_offset_c, 0) AS off
             FROM tracking.vehicle_positions p
             JOIN fleet.vehicles v ON v.id = p.vehicle_id AND v.tenant_id = p.tenant_id
             WHERE p.tenant_id = ?::uuid AND p.vehicle_id = ANY(?::uuid[])
               AND p.quality <> 0
               AND p.captured_at >= ? AND p.captured_at < ?
               AND ((p.metadata -> 'temps') IS NOT NULL
                    OR (p.metadata #> '{cce,status,temperatures}') IS NOT NULL)
           ),
           readings AS (
             SELECT r.vehicle_id, r.at, r.lat, r.lng, 'cce' || (t->>'slot') AS sensor,
                    (t->>'celsius')::float8 AS rc, (t->>'celsius')::float8 + r.off AS c
             FROM raw r
             CROSS JOIN LATERAL jsonb_array_elements(
               CASE WHEN jsonb_typeof(r.metadata #> '{cce,status,temperatures}') = 'array'
                    THEN r.metadata #> '{cce,status,temperatures}' ELSE '[]'::jsonb END) t
             WHERE jsonb_typeof(t->'celsius') = 'number'
             UNION ALL
             SELECT r.vehicle_id, r.at, r.lat, r.lng, e.key AS sensor,
                    (e.value #>> '{}')::float8 AS rc, (e.value #>> '{}')::float8 + r.off AS c
             FROM raw r
             CROSS JOIN LATERAL jsonb_each(
               CASE WHEN jsonb_typeof(r.metadata->'temps') = 'object'
                    THEN r.metadata->'temps' ELSE '{}'::jsonb END) e
             WHERE jsonb_typeof(e.value) = 'number'
           ),
           valid AS (
             SELECT DISTINCT ON (vehicle_id, sensor, at) *
             FROM readings
             WHERE rc >= ? AND rc < ?
             ORDER BY vehicle_id, sensor, at
           ),
           marked AS (
             SELECT vehicle_id, sensor, at, lat, lng, c,
                    CASE WHEN ?::float8 IS NOT NULL AND c > ?::float8 THEN 'HIGH'
                         WHEN ?::float8 IS NOT NULL AND c < ?::float8 THEN 'LOW'
                         ELSE 'OK' END AS state,
                    LAG(at) OVER w AS prev_at,
                    LEAD(at) OVER w AS next_at
             FROM valid
             WINDOW w AS (PARTITION BY vehicle_id, sensor ORDER BY at)
           ),
           staged AS (
             SELECT *, LAG(state) OVER (PARTITION BY vehicle_id, sensor ORDER BY at) AS prev_state
             FROM marked
           ),
           islands AS (
             SELECT *,
                    SUM(CASE WHEN prev_at IS NULL OR state IS DISTINCT FROM prev_state
                               OR at - prev_at > make_interval(secs => ?) THEN 1 ELSE 0 END)
                      OVER (PARTITION BY vehicle_id, sensor ORDER BY at
                            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS grp
             FROM staged
           ),
           episodes AS (
             SELECT vehicle_id, sensor, MIN(state) AS kind,
                    MIN(at) AS started_at,
                    MAX(CASE WHEN next_at IS NOT NULL AND next_at - at <= make_interval(secs => ?)
                             THEN next_at ELSE at END) AS ended_at,
                    MIN(c) AS min_c, MAX(c) AS max_c, AVG(c) AS avg_c, COUNT(*)::int AS readings,
                    (ARRAY_AGG(lat ORDER BY at))[1] AS start_lat,
                    (ARRAY_AGG(lng ORDER BY at))[1] AS start_lng
             FROM islands
             WHERE state <> 'OK'
             GROUP BY vehicle_id, sensor, grp
           ),
           kept AS (
             SELECT * FROM episodes
             WHERE EXTRACT(EPOCH FROM (ended_at - started_at)) >= ?
             ORDER BY vehicle_id, started_at, sensor
             LIMIT ?
           )
           SELECT
             (SELECT COALESCE(json_agg(k ORDER BY k.vehicle_id, k.started_at, k.sensor), '[]'::json)
                FROM kept k) AS episodes,
             (SELECT COALESCE(json_agg(s), '[]'::json) FROM (
                SELECT vehicle_id, sensor, COUNT(*)::int AS readings,
                       MIN(c) AS min_c, MAX(c) AS max_c
                FROM valid GROUP BY vehicle_id, sensor) s) AS sensors`,
          [
            tenantId,
            ids,
            win.from,
            win.to,
            TEMP_PLAUSIBLE_MIN_C,
            TEMP_PLAUSIBLE_MAX_C,
            bounds.maxC,
            bounds.maxC,
            bounds.minC,
            bounds.minC,
            TEMP_GAP_SEC,
            TEMP_GAP_SEC,
            minDurationSec,
            episodeCap + 1,
          ],
        )
      ).rows[0] as { episodes: unknown; sensors: unknown };

      const label = new Map(vehicles.map((v) => [v.vehicleId, v.label]));
      const episodeRows = asArray(result.episodes);
      return {
        vehicles,
        truncated: episodeRows.length > episodeCap,
        episodes: episodeRows.slice(0, episodeCap).map((r) => ({
          vehicleId: String(r.vehicle_id),
          sensor: String(r.sensor),
          kind: r.kind === 'LOW' ? 'LOW' : 'HIGH',
          startedAt: new Date(String(r.started_at)),
          endedAt: new Date(String(r.ended_at)),
          minC: round2(Number(r.min_c)),
          maxC: round2(Number(r.max_c)),
          avgC: round2(Number(r.avg_c)),
          readings: Number(r.readings),
          startLat: Number(r.start_lat),
          startLng: Number(r.start_lng),
        })),
        sensors: asArray(result.sensors).map((r) => ({
          vehicleId: String(r.vehicle_id),
          label: label.get(String(r.vehicle_id)) ?? String(r.vehicle_id),
          sensor: String(r.sensor),
          readings: Number(r.readings),
          minC: round2(Number(r.min_c)),
          maxC: round2(Number(r.max_c)),
        })),
      };
    });
  }
  // ── Objects (live status) ──────────────────────────────────────────────────

  /**
   * Every vehicle in scope with its primary tracker and the newest stored fix
   * (index-backed per-vehicle lookup), plus the tracker's connection state.
   */
  public async objects(tenantId: string, filter: VehicleFilter): Promise<ObjectStatusRow[]> {
    const vf = vehicleFilter(filter);
    return this.query(async (trx) => {
      const rows = (
        await trx.raw(
          `SELECT v.id, ${VEHICLE_LABEL_SQL} AS label, v.plate, v.vin, v.status AS vehicle_status,
                  v.odometer_km AS registry_odometer, v.engine_hours,
                  f.name AS fleet_name,
                  d.imei, d.model, d.sim_number, d.status AS device_status,
                  ds.state AS connection,
                  pos.captured_at, pos.ingested_at, pos.latitude, pos.longitude, pos.speed_kmh,
                  pos.altitude_m, pos.heading_deg, pos.odometer_km AS fix_odometer
           FROM fleet.vehicles v
           LEFT JOIN fleet.fleets f ON f.id = v.fleet_id AND f.tenant_id = v.tenant_id
           LEFT JOIN LATERAL (
             SELECT dd.id, dd.imei, dd.model, dd.sim_number, dd.status
             FROM fleet.vehicle_devices vd
             JOIN fleet.devices dd ON dd.id = vd.device_id AND dd.tenant_id = vd.tenant_id
             WHERE vd.tenant_id = v.tenant_id AND vd.vehicle_id = v.id
             ORDER BY vd.is_primary DESC, vd.bound_at
             LIMIT 1
           ) d ON TRUE
           LEFT JOIN tracking.device_status ds ON ds.device_id = d.id AND ds.tenant_id = v.tenant_id
           LEFT JOIN LATERAL (
             SELECT p.captured_at, p.ingested_at, p.latitude, p.longitude, p.speed_kmh,
                    p.altitude_m, p.heading_deg, p.odometer_km
             FROM tracking.vehicle_positions p
             WHERE p.tenant_id = v.tenant_id AND p.vehicle_id = v.id AND p.quality IN (1, 3)
             ORDER BY p.captured_at DESC
             LIMIT 1
           ) pos ON TRUE
           WHERE v.tenant_id = ?::uuid AND v.status <> 'ARCHIVED' ${vf.clause}`,
          [tenantId, ...vf.binds],
        )
      ).rows as Array<Record<string, unknown>>;
      const num = (x: unknown) => (x === null || x === undefined ? null : Number(x));
      const iso = (x: unknown) => (x ? new Date(x as string | Date).toISOString() : null);
      return rows.map((r) => ({
        vehicleId: String(r.id),
        name: String(r.label ?? r.id),
        imei: r.imei ? String(r.imei) : null,
        plate: r.plate ? String(r.plate) : null,
        fleetName: r.fleet_name ? String(r.fleet_name) : null,
        model: r.model ? String(r.model) : null,
        vin: r.vin ? String(r.vin) : null,
        simNumber: r.sim_number ? String(r.sim_number) : null,
        active: r.vehicle_status === 'ACTIVE' && (r.device_status ?? 'ACTIVE') === 'ACTIVE',
        lat: num(r.latitude),
        lng: num(r.longitude),
        speedKmh:
          r.speed_kmh === null || r.speed_kmh === undefined
            ? null
            : Math.round(Number(r.speed_kmh)),
        altitudeM:
          r.altitude_m === null || r.altitude_m === undefined
            ? null
            : Math.round(Number(r.altitude_m)),
        headingDeg:
          r.heading_deg === null || r.heading_deg === undefined
            ? null
            : Math.round(Number(r.heading_deg)),
        odometerKm: num(r.fix_odometer ?? r.registry_odometer),
        engineHours: num(r.engine_hours),
        lastFixAt: iso(r.captured_at),
        lastReceivedAt: iso(r.ingested_at),
        connection: r.connection ? String(r.connection) : null,
      }));
    });
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function asArray(value: unknown): Array<Record<string, unknown>> {
  const v = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
}

function groupFixes(rows: ReadonlyArray<Record<string, unknown>>): Map<string, SpeedFix[]> {
  const out = new Map<string, SpeedFix[]>();
  for (const r of rows) {
    const id = String(r.vehicle_id);
    const fix: SpeedFix = {
      at: new Date(r.captured_at as string | Date),
      lat: Number(r.latitude),
      lng: Number(r.longitude),
      speedKmh: Number(r.speed_kmh),
    };
    const list = out.get(id);
    if (list) list.push(fix);
    else out.set(id, [fix]);
  }
  return out;
}

function vehicleFilter(filter: VehicleFilter): { clause: string; binds: unknown[] } {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (filter.vehicleId) {
    clauses.push('v.id = ?::uuid');
    binds.push(filter.vehicleId);
  }
  if (filter.fleetId) {
    clauses.push('v.fleet_id = ?::uuid');
    binds.push(filter.fleetId);
  }
  return { clause: clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '', binds };
}
