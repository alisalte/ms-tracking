/**
 * Mine operations reports.
 *
 * Device activity is the start-of-work record: the first stored fix after the
 * device belongs to this tenant, how many fixes arrived in the window, how
 * long the track was silent, and the filtered distance. Haul cycles are
 * computed on read from the same positions — a service is origin, leave,
 * destination.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import {
  type DriverInterval,
  type TrackSample,
  type Zone,
  detectHaulCycles,
  summarizeHauls,
} from '../domain/haul-cycles.js';
import {
  type ReportWindow,
  parseReportWindow,
  reportWindowErrorMessage,
} from '../domain/report-window.js';
import { ReportInputError, type ReportQueryBase } from './report.service.js';

const POSITION_CAP = 60_000;
const TIME_ZONE = 'Asia/Tehran';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ActivityRow {
  device_id: string;
  imei: string;
  protocol: string;
  status: string;
  vehicle_id: string | null;
  vehicle_name: string | null;
  vehicle_code: string | null;
  plate: string | null;
  started_at: Date | string | null;
  fixes: number | string;
  last_fix: Date | string | null;
  distance_m: number | string;
  offline_sec: number | string | null;
}

interface MemberRow {
  device_id: string;
  role: 'TRUCK' | 'SHOVEL';
  imei: string | null;
  vehicle_id: string | null;
  vehicle_name: string | null;
}

interface GeofenceRow {
  id: string;
  geofence_type: string;
  lat: number | string | null;
  lng: number | string | null;
  radius_m: number | string | null;
  boundary: string | { coordinates?: number[][][] } | null;
}

interface PointRow {
  vehicle_id: string;
  captured_at: Date | string;
  latitude: number | string;
  longitude: number | string;
}

interface DriverRow {
  vehicle_id: string;
  driver_id: string;
  driver_name: string;
  started_at: Date | string;
  ended_at: Date | string | null;
}

export class OperationsReportService {
  constructor(
    private readonly knex: Knex,
    private readonly queryTimeoutMs: number,
  ) {}

  public async deviceActivity(tenantId: string, input: ReportQueryBase) {
    const window = this.window(input);
    const { rows } = await this.query<{ rows: ActivityRow[] }>((trx) =>
      trx.raw(ACTIVITY_SQL, [
        tenantId,
        tenantId,
        window.from,
        window.to,
        tenantId,
        window.to,
        window.from,
        window.to,
        window.to,
      ]),
    );
    const devices = rows.map(toActivity);
    const counted = new Set<string>();
    let totalDistanceM = 0;
    for (const row of rows) {
      if (!row.vehicle_id || counted.has(row.vehicle_id)) continue;
      counted.add(row.vehicle_id);
      totalDistanceM += num(row.distance_m);
    }
    return {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      totalDistanceKm: km(totalDistanceM),
      silentCount: devices.filter((row) => row.silent).length,
      reportingCount: devices.filter((row) => row.fixes > 0).length,
      devices,
    };
  }

  public async haulCycles(tenantId: string, routeId: string | undefined, input: ReportQueryBase) {
    if (!routeId || !UUID_RE.test(routeId)) {
      throw new ReportInputError('routeId must be a haul route id', 'INVALID_FILTER');
    }
    const window = this.window(input);
    const route = await this.loadRoute(tenantId, routeId);
    const members = await this.loadMembers(tenantId, routeId);
    const origin = await this.loadZone(tenantId, route.origin_geofence_id);
    const destination = await this.loadZone(tenantId, route.destination_geofence_id);
    const vehicleIds = [
      ...new Set(members.map((row) => row.vehicle_id).filter((id): id is string => Boolean(id))),
    ];
    const points = await this.loadPoints(tenantId, vehicleIds, window);
    const drivers = await this.loadDrivers(tenantId, vehicleIds, window);
    const byVehicle = new Map<string, TrackSample[]>();
    for (const point of points.rows) {
      const samples = byVehicle.get(point.vehicle_id) ?? [];
      samples.push({
        at: asDate(point.captured_at),
        lat: num(point.latitude),
        lng: num(point.longitude),
      });
      byVehicle.set(point.vehicle_id, samples);
    }
    const tracks = new Map<string, readonly TrackSample[]>();
    const trucks: string[] = [];
    const shovels: string[] = [];
    const vehicleName = new Map<string, string>();
    const shovelLabel = new Map<string, string>();
    const unbound: Array<{ deviceId: string; imei: string | null; role: 'TRUCK' | 'SHOVEL' }> = [];
    for (const member of members) {
      const label = member.vehicle_name ?? member.imei ?? member.device_id;
      if (member.role === 'SHOVEL') shovelLabel.set(member.device_id, member.imei ?? label);
      if (!member.vehicle_id) {
        unbound.push({ deviceId: member.device_id, imei: member.imei, role: member.role });
        continue;
      }
      vehicleName.set(member.vehicle_id, label);
      const samples = byVehicle.get(member.vehicle_id) ?? [];
      if (member.role === 'TRUCK') {
        if (!trucks.includes(member.vehicle_id)) trucks.push(member.vehicle_id);
        tracks.set(member.vehicle_id, samples);
      } else {
        shovels.push(member.device_id);
        tracks.set(member.device_id, samples);
      }
    }
    const detected = detectHaulCycles({
      trucks,
      shovels,
      tracks,
      origin,
      destination,
      drivers,
      shiftStartHour: route.shift_start_hour,
      shiftDurationHours: route.shift_duration_hours,
      timeZone: TIME_ZONE,
    });
    const summary = summarizeHauls(detected.cycles);
    return {
      route: {
        id: route.id,
        name: route.name,
        shiftStartHour: route.shift_start_hour,
        shiftDurationHours: route.shift_duration_hours,
        timeZone: TIME_ZONE,
      },
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      truncated: points.truncated,
      services: detected.cycles.length,
      distanceKm: km(detected.cycles.reduce((sum, cycle) => sum + cycle.distanceM, 0)),
      cycles: detected.cycles.map((cycle) => ({
        vehicleId: cycle.vehicleId,
        vehicleName: vehicleName.get(cycle.vehicleId) ?? cycle.vehicleId,
        shovelId: cycle.shovelId,
        shovelLabel: cycle.shovelId ? (shovelLabel.get(cycle.shovelId) ?? cycle.shovelId) : null,
        driverId: cycle.driverId,
        driverName: cycle.driverName,
        originEnteredAt: cycle.originEnteredAt.toISOString(),
        originLeftAt: cycle.originLeftAt.toISOString(),
        destinationEnteredAt: cycle.destinationEnteredAt.toISOString(),
        loadDwellSec: cycle.loadDwellSec,
        travelSec: cycle.travelSec,
        durationSec: cycle.durationSec,
        distanceKm: km(cycle.distanceM),
        shift: cycle.shift,
      })),
      byVehicle: summary.byVehicle.map((row) => ({
        vehicleId: row.vehicleId,
        vehicleName: vehicleName.get(row.vehicleId) ?? row.vehicleId,
        services: row.services,
        distanceKm: km(row.distanceM),
        durationSec: row.durationSec,
      })),
      byDriverShift: summary.byDriverShift.map((row) => ({
        driverId: row.driverId,
        driverName: row.driverName,
        shift: row.shift,
        services: row.services,
        distanceKm: km(row.distanceM),
        durationSec: row.durationSec,
      })),
      byShovel: summary.byShovel.map((row) => ({
        shovelId: row.shovelId,
        shovelLabel: shovelLabel.get(row.shovelId) ?? row.shovelId,
        loads: row.loads,
      })),
      openHauls: detected.open.map((row) => ({
        vehicleId: row.vehicleId,
        vehicleName: vehicleName.get(row.vehicleId) ?? row.vehicleId,
        phase: row.phase,
        since: row.since.toISOString(),
      })),
      unbound,
    };
  }

  private window(input: ReportQueryBase): ReportWindow {
    const parsed = parseReportWindow({ preset: input.preset, from: input.from, to: input.to });
    if (parsed.error) {
      throw new ReportInputError(reportWindowErrorMessage(parsed.error, 92), parsed.error);
    }
    return parsed.window;
  }

  private async query<T>(fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    return this.knex.transaction(async (trx) => {
      await trx.raw('SET LOCAL TRANSACTION READ ONLY');
      await trx.raw(`SET LOCAL statement_timeout = '${Math.floor(this.queryTimeoutMs)}'`);
      return fn(trx);
    });
  }

  private async loadRoute(tenantId: string, routeId: string) {
    const { rows } = await this.query<{
      rows: Array<{
        id: string;
        name: string;
        origin_geofence_id: string;
        destination_geofence_id: string;
        shift_start_hour: number;
        shift_duration_hours: number;
      }>;
    }>((trx) =>
      trx.raw(
        `SELECT id, name, origin_geofence_id, destination_geofence_id,
                shift_start_hour, shift_duration_hours
         FROM fleet.haul_routes
         WHERE tenant_id = ?::uuid AND id = ?::uuid AND status = 'ACTIVE'`,
        [tenantId, routeId],
      ),
    );
    const route = rows[0];
    if (!route) throw new ReportInputError('Haul route not found', 'INVALID_FILTER');
    return route;
  }

  private async loadMembers(tenantId: string, routeId: string): Promise<MemberRow[]> {
    const { rows } = await this.query<{ rows: MemberRow[] }>((trx) =>
      trx.raw(
        `SELECT m.device_id, m.role, d.imei, vd.vehicle_id, v.name AS vehicle_name
         FROM fleet.haul_members m
         JOIN fleet.devices d ON d.id = m.device_id AND d.tenant_id = m.tenant_id
         LEFT JOIN fleet.vehicle_devices vd
           ON vd.device_id = d.id AND vd.tenant_id = d.tenant_id
         LEFT JOIN fleet.vehicles v ON v.id = vd.vehicle_id AND v.tenant_id = d.tenant_id
         WHERE m.tenant_id = ?::uuid AND m.route_id = ?::uuid`,
        [tenantId, routeId],
      ),
    );
    return rows;
  }

  private async loadZone(tenantId: string, geofenceId: string): Promise<Zone> {
    const { rows } = await this.query<{ rows: GeofenceRow[] }>((trx) =>
      trx.raw(
        `SELECT id, geofence_type,
                ST_Y(center::geometry) AS lat,
                ST_X(center::geometry) AS lng,
                radius_m,
                ST_AsGeoJSON(boundary::geometry) AS boundary
         FROM tracking.geofences
         WHERE tenant_id = ?::uuid AND id = ?::uuid`,
        [tenantId, geofenceId],
      ),
    );
    const row = rows[0];
    if (!row) throw new ReportInputError('Haul geofence not found', 'INVALID_FILTER');
    return zoneFrom(row);
  }

  private async loadPoints(
    tenantId: string,
    vehicleIds: readonly string[],
    window: ReportWindow,
  ): Promise<{ rows: PointRow[]; truncated: boolean }> {
    if (vehicleIds.length === 0) return { rows: [], truncated: false };
    const { rows } = await this.query<{ rows: PointRow[] }>((trx) =>
      trx.raw(
        `SELECT vehicle_id, captured_at, latitude, longitude
         FROM tracking.vehicle_positions
         WHERE tenant_id = ?::uuid
           AND quality IN (1, 3)
           AND captured_at >= ? AND captured_at < ?
           AND vehicle_id = ANY(?::uuid[])
         ORDER BY vehicle_id, captured_at
         LIMIT ${POSITION_CAP}`,
        [tenantId, window.from, window.to, vehicleIds],
      ),
    );
    return { rows, truncated: rows.length >= POSITION_CAP };
  }

  private async loadDrivers(
    tenantId: string,
    vehicleIds: readonly string[],
    window: ReportWindow,
  ): Promise<DriverInterval[]> {
    if (vehicleIds.length === 0) return [];
    const { rows } = await this.query<{ rows: DriverRow[] }>((trx) =>
      trx.raw(
        `SELECT a.vehicle_id, a.driver_id, a.started_at, a.ended_at,
                BTRIM(d.first_name || ' ' || d.last_name) AS driver_name
         FROM fleet.driver_assignments a
         JOIN fleet.drivers d ON d.id = a.driver_id AND d.tenant_id = a.tenant_id
         WHERE a.tenant_id = ?::uuid
           AND a.vehicle_id = ANY(?::uuid[])
           AND a.started_at < ?
           AND (a.ended_at IS NULL OR a.ended_at > ?)`,
        [tenantId, vehicleIds, window.to, window.from],
      ),
    );
    return rows.map((row) => ({
      vehicleId: row.vehicle_id,
      driverId: row.driver_id,
      driverName: row.driver_name,
      startedAt: asDate(row.started_at),
      endedAt: row.ended_at ? asDate(row.ended_at) : null,
    }));
  }
}

const ACTIVITY_SQL = `
WITH roster AS (
  SELECT d.id AS device_id, d.imei, d.protocol, d.status,
         vd.vehicle_id, v.name AS vehicle_name, v.code AS vehicle_code, v.plate
  FROM fleet.devices d
  LEFT JOIN fleet.vehicle_devices vd
    ON vd.device_id = d.id AND vd.tenant_id = d.tenant_id
  LEFT JOIN fleet.vehicles v
    ON v.id = vd.vehicle_id AND v.tenant_id = d.tenant_id
  WHERE d.tenant_id = ?::uuid AND d.status <> 'DECOMMISSIONED'
),
window_fixes AS (
  SELECT pos.vehicle_id, pos.captured_at, pos.latitude, pos.longitude,
         LAG(pos.captured_at) OVER (PARTITION BY pos.vehicle_id ORDER BY pos.captured_at) AS prev_at,
         LAG(pos.latitude) OVER (PARTITION BY pos.vehicle_id ORDER BY pos.captured_at) AS prev_lat,
         LAG(pos.longitude) OVER (PARTITION BY pos.vehicle_id ORDER BY pos.captured_at) AS prev_lng
  FROM tracking.vehicle_positions pos
  WHERE pos.tenant_id = ?::uuid
    AND pos.quality IN (1, 3)
    AND pos.captured_at >= ? AND pos.captured_at < ?
    AND pos.vehicle_id IN (SELECT vehicle_id FROM roster WHERE vehicle_id IS NOT NULL)
),
step AS (
  SELECT vehicle_id, captured_at,
         CASE WHEN prev_at IS NULL THEN NULL
              ELSE EXTRACT(EPOCH FROM (captured_at - prev_at)) END AS dt_sec,
         CASE WHEN prev_at IS NULL THEN NULL
              ELSE 6371000 * 2 * asin(LEAST(1::float8, sqrt(
                power(sin(radians(latitude - prev_lat) / 2), 2)
                + cos(radians(prev_lat)) * cos(radians(latitude))
                  * power(sin(radians(longitude - prev_lng) / 2), 2)
              ))) END AS meters
  FROM window_fixes
),
agg AS (
  SELECT vehicle_id,
         COUNT(*)::int AS fixes,
         MAX(captured_at) AS last_fix,
         COALESCE(SUM(CASE WHEN dt_sec > 300 THEN dt_sec - 300 ELSE 0 END), 0) AS gap_offline_sec,
         COALESCE(SUM(CASE
           WHEN dt_sec > 1 AND meters > 1 AND (meters * 3.6 / dt_sec) <= 100 THEN meters
           ELSE 0 END), 0) AS distance_m
  FROM step
  GROUP BY vehicle_id
),
lifetime AS (
  SELECT pos.vehicle_id, MIN(pos.captured_at) AS started_at
  FROM tracking.vehicle_positions pos
  WHERE pos.tenant_id = ?::uuid
    AND pos.quality IN (1, 3)
    AND pos.vehicle_id IN (SELECT vehicle_id FROM roster WHERE vehicle_id IS NOT NULL)
  GROUP BY pos.vehicle_id
)
SELECT r.device_id, r.imei, r.protocol, r.status,
       r.vehicle_id, r.vehicle_name, r.vehicle_code, r.plate,
       l.started_at,
       COALESCE(a.fixes, 0) AS fixes,
       a.last_fix,
       COALESCE(a.distance_m, 0) AS distance_m,
       CASE
         WHEN r.vehicle_id IS NULL OR l.started_at IS NULL THEN NULL
         WHEN a.last_fix IS NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (?::timestamptz - ?::timestamptz)) - 300)
         ELSE COALESCE(a.gap_offline_sec, 0) + CASE
           WHEN EXTRACT(EPOCH FROM (?::timestamptz - a.last_fix)) > 300
           THEN EXTRACT(EPOCH FROM (?::timestamptz - a.last_fix)) - 300
           ELSE 0 END
       END AS offline_sec
FROM roster r
LEFT JOIN lifetime l ON l.vehicle_id = r.vehicle_id
LEFT JOIN agg a ON a.vehicle_id = r.vehicle_id
ORDER BY r.imei
`;

function toActivity(row: ActivityRow) {
  const startedAt = row.started_at ? asDate(row.started_at).toISOString() : null;
  return {
    deviceId: row.device_id,
    imei: row.imei,
    protocol: row.protocol,
    status: row.status,
    vehicleId: row.vehicle_id,
    vehicleName: row.vehicle_name,
    vehicleCode: row.vehicle_code,
    plate: row.plate,
    startedAt,
    fixes: Math.round(num(row.fixes)),
    lastFixAt: row.last_fix ? asDate(row.last_fix).toISOString() : null,
    offlineSec: row.offline_sec === null ? null : Math.round(num(row.offline_sec)),
    distanceKm: km(num(row.distance_m)),
    silent: row.vehicle_id === null || startedAt === null,
  };
}

function zoneFrom(row: GeofenceRow): Zone {
  if (
    row.geofence_type === 'CIRCLE' &&
    row.lat !== null &&
    row.lng !== null &&
    row.radius_m !== null
  ) {
    return { kind: 'circle', lat: num(row.lat), lng: num(row.lng), radiusM: num(row.radius_m) };
  }
  const geo =
    typeof row.boundary === 'string'
      ? (JSON.parse(row.boundary) as GeofenceRow['boundary'])
      : row.boundary;
  const ring = geo && typeof geo === 'object' && geo.coordinates ? geo.coordinates[0] : undefined;
  if (!ring || ring.length < 3) {
    throw new ReportInputError('Haul geofence has no usable boundary', 'INVALID_FILTER');
  }
  return {
    kind: 'polygon',
    ring: ring.map((pair) => [Number(pair[0]), Number(pair[1])] as const),
  };
}

function num(value: number | string | null | undefined): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function km(meters: number): number {
  return Math.round((meters / 1000) * 1000) / 1000;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
