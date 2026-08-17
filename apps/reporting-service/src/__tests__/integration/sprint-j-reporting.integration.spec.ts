/**
 * Sprint J reporting integration tests (§52/§53) — REAL PostgreSQL (no db
 * mocks): fleet overview, utilization, trips, alarms, geofences, custom
 * ranges, tenant isolation with EXPLICIT cross-tenant ids, pagination,
 * CSV bytes, and EXPLAIN query-plan verification (§27/§72).
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ReportService } from '../../application/report.service.js';
import { ReportRepository } from '../../infrastructure/persistence/report.repository.js';
import { type IntegrationCtx, bootstrap, dropTestDb } from './db.js';

const TENANT_A = 'aaaaaa91-0000-4000-8000-00000000000a';
const TENANT_B = 'aaaaaa92-0000-4000-8000-00000000000b';
const VEHICLE_A = 'bbbbbb91-0000-4000-8000-0000000000aa';
const VEHICLE_A2 = 'bbbbbb91-0000-4000-8000-0000000000ab';
const VEHICLE_B = 'bbbbbb92-0000-4000-8000-0000000000ba';
const FLEET_A = 'cccccc91-0000-4000-8000-0000000000fa';
const FENCE_A = 'dddddd91-0000-4000-8000-000000000001';

let ctx: IntegrationCtx | null = null;
let repo: ReportRepository | null = null;
let service: ReportService | null = null;

const FROM = new Date('2026-08-10T00:00:00Z');
const TO = new Date('2026-08-17T00:00:00Z');
const WIN = { from: FROM, to: TO };

beforeAll(async () => {
  ctx = await bootstrap('report_sprint_j');
  if (!ctx) return;
  const k = ctx.knex;
  // ── Registry: fleets + vehicles (both tenants) ──
  const fleets: Array<[string, string]> = [
    [TENANT_A, FLEET_A],
    [TENANT_B, 'cccccc92-0000-4000-8000-0000000000fb'],
  ];
  for (const [tid, fid] of fleets) {
    await k.raw(
      'INSERT INTO fleet.fleets (id, tenant_id, name, code) VALUES (?::uuid, ?::uuid, ?, ?)',
      [fid, tid, `Fleet ${fid.slice(0, 6)}`, `FL-${fid.slice(0, 4)}`],
    );
  }
  const vehicles: Array<[string, string, string, string]> = [
    [VEHICLE_A, TENANT_A, FLEET_A, '12-A-100'],
    [VEHICLE_A2, TENANT_A, FLEET_A, '12-A-200'],
    [VEHICLE_B, TENANT_B, 'cccccc92-0000-4000-8000-0000000000fb', '12-B-100'],
  ];
  for (const [id, tid, fid, plate] of vehicles) {
    await k.raw(
      `INSERT INTO fleet.vehicles (id, tenant_id, fleet_id, name, code, plate)
       VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, ?)`,
      [id, tid, fid, `V-${id.slice(0, 6)}`, `C-${id.slice(-4)}`, plate],
    );
  }
  // ── Trips (A: 2 completed + 1 discarded; B: 1 completed) ──
  const trip = async (
    tid: string,
    vid: string,
    status: string,
    startedAt: Date,
    hours: number,
    km: number,
    maxKmh: number,
  ) => {
    await k.raw(
      `INSERT INTO tracking.trip_events (tenant_id, vehicle_id, status, started_at, ended_at, start_lat, start_lng, distance_km, duration_s, max_speed_kmh)
       VALUES (?::uuid, ?::uuid, ?, ?, ?, 35.7, 51.4, ?, ?, ?)`,
      [
        tid,
        vid,
        status,
        startedAt.toISOString(),
        new Date(startedAt.getTime() + hours * 3_600_000).toISOString(),
        km,
        hours * 3600,
        maxKmh,
      ],
    );
  };
  await trip(TENANT_A, VEHICLE_A, 'COMPLETED', new Date('2026-08-12T08:00:00Z'), 2, 90, 95);
  await trip(TENANT_A, VEHICLE_A, 'COMPLETED', new Date('2026-08-13T09:00:00Z'), 1, 40, 80);
  await trip(TENANT_A, VEHICLE_A2, 'COMPLETED', new Date('2026-08-12T10:00:00Z'), 3, 150, 110);
  await trip(TENANT_A, VEHICLE_A, 'DISCARDED', new Date('2026-08-14T11:00:00Z'), 0.05, 0.2, 20);
  await trip(TENANT_B, VEHICLE_B, 'COMPLETED', new Date('2026-08-12T08:00:00Z'), 1, 55, 70);
  // ── Idle + parking (A only) ──
  await k.raw(
    `INSERT INTO tracking.idle_periods (tenant_id, vehicle_id, started_at, ended_at, duration_s)
     VALUES (?::uuid, ?::uuid, '2026-08-12T09:00:00Z', '2026-08-12T09:20:00Z', 1200),
            (?::uuid, ?::uuid, '2026-08-13T09:30:00Z', '2026-08-13T09:40:00Z', 600)`,
    [TENANT_A, VEHICLE_A, TENANT_A, VEHICLE_A],
  );
  await k.raw(
    `INSERT INTO tracking.parking_periods (tenant_id, vehicle_id, started_at, ended_at, duration_s, status, lat, lng)
     VALUES (?::uuid, ?::uuid, '2026-08-12T20:00:00Z', '2026-08-13T04:00:00Z', 28800, 'ENDED', 35.7, 51.4)`,
    [TENANT_A, VEHICLE_A],
  );
  // ── Positions (A: 4 h coverage; B: 1 h) ──
  for (let i = 0; i < 4; i++) {
    await k.raw(
      `INSERT INTO tracking.vehicle_positions (tenant_id, vehicle_id, captured_at, geom, latitude, longitude, speed_kmh, quality)
       VALUES (?::uuid, ?::uuid, ?, ST_SetSRID(ST_MakePoint(51.4, 35.7), 4326)::geography, 35.7, 51.4, 30, 1)`,
      [TENANT_A, VEHICLE_A, new Date(FROM.getTime() + (i + 1) * 3_600_000).toISOString()],
    );
  }
  await k.raw(
    `INSERT INTO tracking.vehicle_positions (tenant_id, vehicle_id, captured_at, geom, latitude, longitude, speed_kmh, quality)
     VALUES (?::uuid, ?::uuid, '2026-08-12T08:30:00Z', ST_SetSRID(ST_MakePoint(51.4, 35.7), 4326)::geography, 35.7, 51.4, 30, 1)`,
    [TENANT_B, VEHICLE_B],
  );
  // ── Alarms (A: overspeed×2 + geofence_enter; B: overspeed×1) ──
  const alarm = async (
    tid: string,
    vid: string,
    type: string,
    severity: string,
    at: string,
    status: string,
  ) => {
    await k.raw(
      `INSERT INTO notification.alerts (tenant_id, rule_id, type, severity, status, vehicle_id, message, raised_at, resolved_at)
       VALUES (?::uuid, gen_random_uuid(), ?, ?, ?, ?::uuid, ?, ?, ?)`,
      [tid, type, severity, status, vid, `${type} alarm`, at, status === 'RESOLVED' ? at : null],
    );
  };
  await alarm(TENANT_A, VEHICLE_A, 'overspeed', 'HIGH', '2026-08-12T08:30:00Z', 'RESOLVED');
  await alarm(TENANT_A, VEHICLE_A, 'overspeed', 'HIGH', '2026-08-13T09:30:00Z', 'OPEN');
  await alarm(
    TENANT_A,
    VEHICLE_A2,
    'geofence_enter',
    'MEDIUM',
    '2026-08-12T11:00:00Z',
    'ACKNOWLEDGED',
  );
  await alarm(TENANT_B, VEHICLE_B, 'overspeed', 'HIGH', '2026-08-12T08:40:00Z', 'OPEN');
  // ── Geofence + FleetEvents (A only: enter/exit/dwell with dwellSec) ──
  await k.raw(
    `INSERT INTO tracking.geofences (id, tenant_id, name, geofence_type, boundary)
     VALUES (?::uuid, ?::uuid, 'Depot A', 'POLYGON',
       ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[51.3,35.6],[51.5,35.6],[51.5,35.8],[51.3,35.8],[51.3,35.6]]]}')::geography)`,
    [FENCE_A, TENANT_A],
  );
  const geoEvent = async (type: string, at: string, dwellSec: number | null) => {
    const id = `ev-${type}-${at}`;
    await k.raw(
      `INSERT INTO notification.fleet_events (id, tenant_id, vehicle_id, event_type, occurred_at, metadata)
       VALUES (?, ?::uuid, ?::uuid, ?, ?, ?::jsonb)`,
      [
        id,
        TENANT_A,
        VEHICLE_A,
        type,
        at,
        JSON.stringify({ geofenceId: FENCE_A, geofenceName: 'Depot A', dwellSec }),
      ],
    );
  };
  await geoEvent('geofence.entered', '2026-08-12T08:10:00Z', null);
  await geoEvent('geofence.exited', '2026-08-12T09:10:00Z', 3600);
  await geoEvent('geofence.dwell', '2026-08-12T08:50:00Z', 2400);

  repo = new ReportRepository({ knex: k as never, queryTimeoutMs: 15_000 });
  service = new ReportService({
    config: {
      REPORT_MAX_RANGE_DAYS: 92,
      REPORT_QUERY_TIMEOUT_MS: 15_000,
      REPORT_CACHE_TTL_SECONDS: 30,
      REPORT_EXPORT_RATE_LIMIT: 5,
      REPORT_EXPORT_RATE_WINDOW_SECONDS: 60,
      REPORT_EXPORT_MAX_ROWS: 1000,
      REPORT_MAX_PAGE_SIZE: 200,
    } as never,
    repository: repo,
    cache: null,
    exportLimiter: null,
    audit: null,
    metrics: null,
  });
}, 180_000);

afterAll(async () => {
  if (!ctx) return;
  await ctx.knex.destroy();
  await dropTestDb(ctx.admin, 'report_sprint_j');
  await ctx.admin.destroy();
});

describe('Sprint J — reporting on real PostgreSQL', () => {
  it('skips when the docker stack is unreachable', () => {
    if (!ctx || !repo) return;
  });

  it('1. fleet overview aggregates real projections (§6)', async () => {
    if (!repo) return;
    const o = await repo.fleetOverview(TENANT_A, WIN, {});
    expect(o.totalVehicles).toBe(2);
    expect(o.movingVehicles).toBe(2);
    expect(o.idleVehicles).toBe(1);
    expect(o.parkedVehicles).toBe(1);
    expect(o.vehiclesWithTelemetry).toBe(1); // only VEHICLE_A has positions
    expect(o.noTelemetryVehicles).toBe(1);
    expect(o.totalDistanceKm).toBeCloseTo(280, 0);
    expect(o.totalTrips).toBe(3);
    expect(o.totalAlarms).toBe(3);
    expect(o.openAlarms).toBe(1);
    expect(o.geofenceEvents).toBe(3);
    expect(o.avgUtilizationPct).not.toBeNull();
  });

  it('2. vehicle utilization — documented formula, null ≠ zero (§7/§60)', async () => {
    if (!repo) return;
    const { rows } = await repo.vehicleUtilization(
      TENANT_A,
      WIN,
      {},
      { expression: 'utilization_pct', direction: 'DESC' },
      50,
      0,
    );
    const a = rows.find((r) => r.vehicleId === VEHICLE_A);
    const a2 = rows.find((r) => r.vehicleId === VEHICLE_A2);
    expect(a?.movingSec).toBe(3 * 3600);
    expect(a?.idleSec).toBe(1800);
    expect(a?.parkingSec).toBe(28_800);
    expect(a?.distanceKm).toBeCloseTo(130, 0);
    // VEHICLE_A2 has NO positions → observedSec/utilization null (never zero).
    expect(a2?.observedSec).toBeNull();
    expect(a2?.utilizationPct).toBeNull();
    expect(a2?.movingSec).toBe(3 * 3600);
    // utilization = moving / observed (VEHICLE_A observed = 3 h of coverage).
    expect(a?.utilizationPct).toBeCloseTo(((3 * 3600) / (3 * 3600)) * 100, 0);
  });

  it('3. trip report — cursor pagination + per-trip idle/parking overlap (§9/§21)', async () => {
    if (!repo) return;
    const page1 = await repo.trips(
      TENANT_A,
      WIN,
      {},
      { expression: 't.started_at', direction: 'DESC' },
      2,
      null,
    );
    expect(page1.rows).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await repo.trips(
      TENANT_A,
      WIN,
      {},
      { expression: 't.started_at', direction: 'DESC' },
      2,
      page1.nextCursor,
    );
    expect(page2.rows).toHaveLength(1);
    // The 08-12 08:00 2h trip overlaps the 10:00-10:20 idle → 1200 idle sec.
    const first = page2.rows.find((r) => r.startedAt === '2026-08-12T08:00:00.000Z');
    expect(first?.idleSec).toBe(1200);
    expect(first?.label).toBe('12-A-100');
  });

  it('4. distance report (§8)', async () => {
    if (!repo) return;
    const { rows } = await repo.distance(TENANT_A, WIN, {}, 50, 0);
    const a = rows.find((r) => r.vehicleId === VEHICLE_A);
    expect(a?.distanceKm).toBeCloseTo(130, 0);
    expect(a?.trips).toBe(2);
    expect(a?.avgTripKm).toBeCloseTo(65, 0);
    expect(a?.maxTripKm).toBeCloseTo(90, 0);
    expect(a?.discardedTrips).toBe(1);
  });

  it('5. speed report uses alarm-engine speeding counts (§10/§63)', async () => {
    if (!repo) return;
    const { rows } = await repo.speed(TENANT_A, WIN, {}, 50, 0);
    const a = rows.find((r) => r.vehicleId === VEHICLE_A);
    expect(a?.speedingAlarms).toBe(2);
    expect(a?.maxSpeedKph).toBe(95);
  });

  it('6. idle/parking report separates kinds (§11)', async () => {
    if (!repo) return;
    const { rows } = await repo.idleParking(TENANT_A, WIN, {}, undefined, 50, null);
    expect(rows.filter((r) => r.kind === 'IDLE')).toHaveLength(2);
    expect(rows.filter((r) => r.kind === 'PARKING')).toHaveLength(1);
    const onlyIdle = await repo.idleParking(TENANT_A, WIN, {}, 'IDLE', 50, null);
    expect(onlyIdle.rows.every((r) => r.kind === 'IDLE')).toBe(true);
  });

  it('7. alarm aggregates by vehicle/type/severity + summary (§12)', async () => {
    if (!repo) return;
    const { rows, total, summary } = await repo.alarms(TENANT_A, WIN, {}, 50, 0);
    expect(total).toBe(3);
    expect(summary.open).toBe(1);
    expect(summary.resolved).toBe(1);
    expect(summary.acknowledged).toBe(1);
    expect(summary.high).toBe(2);
    const overspeed = rows.find((r) => r.type === 'overspeed');
    expect(overspeed?.total).toBe(2);
    const sevFiltered = await repo.alarms(TENANT_A, WIN, { severity: 'MEDIUM' }, 50, 0);
    expect(sevFiltered.total).toBe(1);
  });

  it('8. alarm trend daily buckets (§13)', async () => {
    if (!repo) return;
    const pts = await repo.alarmTrend(TENANT_A, WIN, {});
    const d12 = pts.find((p) => p.day === '2026-08-12');
    const d13 = pts.find((p) => p.day === '2026-08-13');
    expect(d12?.speeding).toBe(1);
    expect(d12?.geofence).toBe(1);
    expect(d13?.speeding).toBe(1);
  });

  it('9. geofence report from the authoritative event pipeline (§14/§64)', async () => {
    if (!repo) return;
    const { rows } = await repo.geofenceReport(TENANT_A, WIN, {}, 50, 0);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.geofenceName).toBe('Depot A');
    expect(r.enters).toBe(1);
    expect(r.exits).toBe(1);
    expect(r.dwells).toBe(1);
    expect(r.timeInsideSec).toBe(3600); // EXIT dwellSec = occupancy
  });

  it('10. activity timeline merges sources with source labels (§15)', async () => {
    if (!repo) return;
    const { rows } = await repo.activity(TENANT_A, WIN, { vehicleId: VEHICLE_A }, 50, null);
    const kinds = new Set(rows.map((r) => r.kind));
    expect(kinds.has('TRIP_STARTED')).toBe(true);
    expect(kinds.has('IDLE')).toBe(true);
    expect(kinds.has('PARKING')).toBe(true);
    expect(kinds.has('GEOFENCE_ENTER')).toBe(true);
    expect(kinds.has('ALARM')).toBe(true);
    // Chronological (desc).
    const times = rows.map((r) => Date.parse(r.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    // Sources are the authoritative domains.
    expect(
      rows.every((r) => r.source.startsWith('gps-engine.') || r.source.startsWith('notification.')),
    ).toBe(true);
  });

  it('11. custom date range via the service layer (§16)', async () => {
    if (!service) return;
    const narrow = await service.trips(TENANT_A, {
      from: '2026-08-13T00:00:00Z',
      to: '2026-08-14T00:00:00Z',
    });
    expect((narrow as { items: unknown[] }).items).toHaveLength(1);
  });

  it('12/13. TENANT ISOLATION — cross-tenant ids supplied explicitly (§53)', async () => {
    if (!repo || !service) return;
    // Overview/trips of A never contain B's vehicles…
    const o = await repo.fleetOverview(TENANT_A, WIN, {});
    expect(o.totalVehicles).toBe(2);
    const t = await repo.trips(
      TENANT_A,
      WIN,
      { vehicleId: VEHICLE_B },
      { expression: 't.started_at', direction: 'DESC' },
      50,
      null,
    );
    expect(t.rows).toHaveLength(0);
    // …and querying B explicitly returns ONLY B's data (never A's).
    const oB = await repo.fleetOverview(TENANT_B, WIN, {});
    expect(oB.totalVehicles).toBe(1);
    expect(oB.totalAlarms).toBe(1);
    const aB = await repo.alarms(TENANT_B, WIN, { vehicleId: VEHICLE_A }, 50, 0);
    expect(aB.total).toBe(0);
    // Window validation + invalid filters are controlled errors.
    await expect(
      service.trips(TENANT_A, { preset: '7d', from: '2026-08-01T00:00:00Z' }),
    ).rejects.toThrow(/not both/);
    await expect(
      service.trips(TENANT_A, { from: '2026-08-01T00:00:00Z', to: '2026-05-01T00:00:00Z' }),
    ).rejects.toThrow(/before/);
  });

  it('14. CSV export bytes — escaping + filters respected (§31/§32)', async () => {
    if (!service) return;
    const csv = await service.exportCsv(TENANT_A, null, 'vehicle-utilization', {
      from: FROM.toISOString(),
      to: TO.toISOString(),
    });
    expect(csv.csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.csv).toContain('vehicle,moving_s,idle_s,parking_s');
    expect(csv.csv).toContain('12-A-100');
    expect(csv.rows).toBe(2);
    // Filter respected: only VEHICLE_A.
    const filtered = await service.exportCsv(TENANT_A, null, 'vehicle-utilization', {
      from: FROM.toISOString(),
      to: TO.toISOString(),
      vehicleId: VEHICLE_A,
    });
    expect(filtered.rows).toBe(1);
    // Formula injection: a plate starting with '=' would be neutralized.
    const { csvCell } = await import('../../domain/csv.js');
    // Neutralized AND RFC-quoted (value contains quotes → outer quoting applies).
    const neutralized = csvCell('=HYPERLINK("x")');
    expect(neutralized).toBe(
      `${String.fromCharCode(34, 39, 61)}HYPERLINK(${String.fromCharCode(34, 34)}x${String.fromCharCode(34, 34)})${String.fromCharCode(34)}`,
    );
    expect(csvCell('=1+1') === "'" + '=1+1').toBe(true);
  });

  it('15. EXPLAIN — report queries use indexes, not seq scans (§27/§72)', async () => {
    if (!ctx || !repo) return;
    await seedBulkTrips(ctx.knex);
    await seedBulkAlarms(ctx.knex);
    await ctx.knex.raw('ANALYZE tracking.trip_events');
    await ctx.knex.raw('ANALYZE notification.alerts');
    const plan = await ctx.knex.raw(
      `EXPLAIN (COSTS OFF) SELECT time_bucket('1 day', t.started_at) AS day, SUM(t.distance_km)
       FROM tracking.trip_events t
       WHERE t.tenant_id = ?::uuid AND t.status = 'COMPLETED'
         AND t.started_at >= ? AND t.started_at < ?
       GROUP BY 1`,
      [TENANT_B, FROM, TO],
    );
    const text = plan.rows.map((r: Record<string, unknown>) => Object.values(r)[0]).join('\n');
    // Index Only Scan is an even better outcome (heap never touched).
    expect(text).toMatch(/Bitmap Index Scan|Index (Only )?Scan/);
    expect(text).toMatch(/ix_trip_events_tenant_started/);
    expect(text).not.toMatch(/Seq Scan on tracking\.trip_events/);
    // Alarms trend rides the Sprint J alerts index.
    const aplan = await ctx.knex.raw(
      `EXPLAIN (COSTS OFF) SELECT time_bucket('1 day', a.raised_at), COUNT(*)
       FROM notification.alerts a
       WHERE a.tenant_id = ?::uuid AND a.raised_at >= ? AND a.raised_at < ?
       GROUP BY 1`,
      [TENANT_A, FROM, TO],
    );
    const atext = aplan.rows.map((r: Record<string, unknown>) => Object.values(r)[0]).join('\n');
    expect(atext).toMatch(/Bitmap Index Scan|Index (Only )?Scan/);
    expect(atext).toMatch(/ix_alerts_tenant_raised/);
    expect(atext).not.toMatch(/Seq Scan on notification\.alerts/);
  });
});

/**
 * Bulk NOISE for the tenant the EXPLAIN does NOT query — selectivity is what
 * makes the planner prefer the (tenant_id, started_at) index: the queried
 * tenant must be a small minority of the table. (Seeding the queried tenant
 * instead makes it ~100% of the table and a Seq Scan genuinely cheaper —
 * the test would defeat itself.)
 */
async function seedBulkTrips(knex: IntegrationCtx['knex']): Promise<void> {
  const rows: Array<unknown[]> = [];
  const start = Date.parse('2026-08-10T00:00:00Z');
  for (let i = 0; i < 3000; i++) {
    rows.push([
      TENANT_A,
      VEHICLE_A,
      'COMPLETED',
      new Date(start + (i % 7) * 86_400_000 + (i % 24) * 3_600_000).toISOString(),
      10 + (i % 50),
    ]);
  }
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const values = chunk
      .map(
        () =>
          `(?::uuid, ?::uuid, 'COMPLETED', ?::timestamptz, ?::timestamptz, 35.7, 51.4, 10, 3600, 80)`,
      )
      .join(',');
    await knex.raw(
      `INSERT INTO tracking.trip_events (tenant_id, vehicle_id, status, started_at, ended_at, start_lat, start_lng, distance_km, duration_s, max_speed_kmh)
       VALUES ${values}`,
      chunk.flatMap((r) => [r[0], r[1], r[3], r[3]]),
    );
  }
}

/** Same noise strategy for the alarms EXPLAIN (bulk = TENANT_B noise; the
 * EXPLAIN queries TENANT_A's 3 alarms → minority → index scan). */
async function seedBulkAlarms(knex: IntegrationCtx['knex']): Promise<void> {
  const rows: Array<unknown[]> = [];
  const start = Date.parse('2026-08-10T00:00:00Z');
  for (let i = 0; i < 3000; i++) {
    rows.push([
      TENANT_B,
      VEHICLE_B,
      new Date(start + (i % 7) * 86_400_000 + (i % 24) * 3_600_000).toISOString(),
    ]);
  }
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const values = chunk
      .map(
        () =>
          `(?::uuid, gen_random_uuid(), 'overspeed', 'HIGH', 'OPEN', ?::uuid, 'noise', ?::timestamptz, NULL)`,
      )
      .join(',');
    await knex.raw(
      `INSERT INTO notification.alerts (tenant_id, rule_id, type, severity, status, vehicle_id, message, raised_at, resolved_at)
       VALUES ${values}`,
      chunk.flatMap((r) => [r[0], r[1], r[2]]),
    );
  }
}
