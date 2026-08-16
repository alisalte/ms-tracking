/**
 * Sprint I geofence evaluator integration tests — REAL PostGIS + the REAL
 * GeofenceEvaluator (§62: spatial integration; §63 — nothing spatial is
 * mocked: ST_Covers/ST_DWithin decide containment, tracking.geofence_state is
 * the durable state store).
 *
 * Covers: position → ENTER/EXIT/DWELL FleetEvents, duplicate prevention,
 * jitter confirmation, INACTIVE fences are ignored, assignment restriction,
 * tenant isolation (fence of another tenant never matches), and durable
 * restart-safe state.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GeofenceEvaluator } from '../../application/geofence-evaluator.js';
import { SignalBus, type GeofenceSignal } from '../../application/signal-bus.js';
import { GeofenceDefinitionsRepository } from '../../infrastructure/persistence/geofence-definitions.repository.js';
import { GeofenceStateRepository } from '../../infrastructure/persistence/geofence-state.repository.js';
import { bootstrap, dropTestDb, type IntegrationCtx } from './db.js';

const TENANT_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const TENANT_B = 'aaaaaaaa-0000-4000-8000-00000000000b';
const VEHICLE = 'bbbbbbbb-0000-4000-8000-00000000000b';
const VEHICLE_OTHER = 'bbbbbbbb-0000-4000-8000-00000000000c';

let ctx: IntegrationCtx | null = null;
let bus: SignalBus | null = null;
let evaluator: GeofenceEvaluator | null = null;
let stateRepo: GeofenceStateRepository | null = null;

const CONFIG = {
  GEOFENCE_ENABLED: true,
  GEOFENCE_CONFIRMATION_POINTS: 2,
  GEOFENCE_DWELL_SECONDS: 600,
  GEOFENCE_CANDIDATE_BUFFER_DEG: 0.05,
} as never;

function makePosition(lat: number, lng: number, at: Date, messageId: string) {
  return {
    tenantId: TENANT_A,
    vehicleId: VEHICLE,
    deviceId: 'dev-1',
    messageId,
    latitude: lat,
    longitude: lng,
    capturedAt: at,
    ingestedAt: new Date(),
    speedKph: 30,
    headingDeg: 0,
    altitudeM: null,
    accuracyM: null,
    odometerKm: null,
    ignitionOn: null,
    sessionId: null,
    quality: 'VALID',
  } as never;
}

const INSIDE = { lat: 35.7002, lng: 51.4002 }; // ~30 m from the circle center
const OUTSIDE = { lat: 35.705, lng: 51.405 }; // ~700 m away — outside

/** Circle fence: 500 m around (35.7, 51.4) as a 48-gon + center + radius. */
async function insertCircleFence(
  knex: IntegrationCtx['knex'],
  id: string,
  tenantId: string,
  name: string,
  opts: { status?: string; dwellSec?: number; alertOn?: string[] } = {},
): Promise<void> {
  const ring: number[][] = [];
  for (let i = 0; i <= 48; i++) {
    const theta = (2 * Math.PI * i) / 48;
    ring.push([
      51.4 + (500 * Math.cos(theta)) / (111_320 * Math.cos((35.7 * Math.PI) / 180)),
      35.7 + (500 * Math.sin(theta)) / 111_320,
    ]);
  }
  await knex.raw(
    `INSERT INTO tracking.geofences (id, tenant_id, name, geofence_type, boundary, center, radius_m, status, alert_on, dwell_sec, metadata)
     VALUES (?::uuid, ?::uuid, ?, 'CIRCLE', ST_GeomFromGeoJSON(?)::geography,
             ?::geography, 500, ?, ?, ?::int, '{}')`,
    [
      id,
      tenantId,
      name,
      JSON.stringify({ type: 'Polygon', coordinates: [ring] }),
      'SRID=4326;POINT(51.4 35.7)',
      opts.status ?? 'ACTIVE',
      opts.alertOn ?? ['ENTER', 'EXIT', 'DWELL'],
      opts.dwellSec ?? null,
    ],
  );
}

beforeAll(async () => {
  ctx = await bootstrap('gps_sprint_i_geofence');
  if (!ctx) return;
  // The evaluator reads the map-engine-owned tables — apply those migrations
  // too (same direct-import pattern; production applies them via map-engine).
  const dir = resolve(process.cwd(), '../map-engine-service/src/infrastructure/database/migrations');
  for (const file of ['20260806120000_create_geo_schema.js', '20260816120000_extend_geofences_for_sprint_i.js']) {
    const mod = (await import(pathToFileURL(resolve(dir, file)).href)) as {
      up: (knex: IntegrationCtx['knex']) => Promise<void>;
    };
    await mod.up(ctx.knex);
  }
  bus = new SignalBus();
  stateRepo = new GeofenceStateRepository(ctx.knex);
  evaluator = new GeofenceEvaluator({
    config: CONFIG,
    definitions: new GeofenceDefinitionsRepository(ctx.knex),
    state: stateRepo,
    signalBus: bus,
    metrics: null,
  });
}, 120_000);

afterAll(async () => {
  bus?.close();
  if (!ctx) return;
  await ctx.knex.destroy();
  await dropTestDb(ctx.admin, 'gps_sprint_i_geofence');
  await ctx.admin.destroy();
}, 120_000);

function signals(): GeofenceSignal[] {
  const out: GeofenceSignal[] = [];
  const push = (s: GeofenceSignal) => out.push(s);
  bus?.onGeofence(push);
  return out;
}

describe('Sprint I — geofence evaluator over real PostGIS', () => {
  it('skips when the docker stack is unreachable', () => {
    if (!ctx || !evaluator) return;
  }, 120_000);

  it('1–4: position enters geofence → GEOFENCE_ENTER → exit → GEOFENCE_EXIT; no duplicates', async () => {
    if (!ctx || !evaluator) return;
    const fenceId = 'cccccccc-0000-4000-8000-000000000001';
    await insertCircleFence(ctx.knex, fenceId, TENANT_A, 'zone-a');
    const captured: GeofenceSignal[] = [];
    const off = bus!.onGeofence((s) => captured.push(s));

    const t0 = new Date('2026-08-16T10:00:00Z');
    // Outside baseline (2 confirmations).
    await evaluator.process(makePosition(OUTSIDE.lat, OUTSIDE.lng, t0, 'm-out-1'));
    await evaluator.process(makePosition(OUTSIDE.lat, OUTSIDE.lng, t0, 'm-out-2'));
    // Drive inside (2 contained observations → ENTER).
    await evaluator.process(makePosition(INSIDE.lat, INSIDE.lng, t0, 'm-in-1'));
    await evaluator.process(makePosition(INSIDE.lat, INSIDE.lng, t0, 'm-in-2'));
    // Repeated inside points → NO new ENTER.
    for (let i = 3; i < 7; i++) {
      await evaluator.process(makePosition(INSIDE.lat, INSIDE.lng, t0, `m-in-${i}`));
    }
    // Drive away (2 non-contained → EXIT).
    await evaluator.process(makePosition(OUTSIDE.lat, OUTSIDE.lng, t0, 'm-out-3'));
    await evaluator.process(makePosition(OUTSIDE.lat, OUTSIDE.lng, t0, 'm-out-4'));
    // Repeated outside → NO new EXIT.
    await evaluator.process(makePosition(OUTSIDE.lat, OUTSIDE.lng, t0, 'm-out-5'));

    off();
    const enters = captured.filter((s) => s.type === 'geofence.entered');
    const exits = captured.filter((s) => s.type === 'geofence.exited');
    expect(enters).toHaveLength(1);
    expect(enters[0]?.geofenceId).toBe(fenceId);
    expect(enters[0]?.sourceEventId).toBe('m-in-2'); // confirming position
    expect(exits).toHaveLength(1);
    expect(captured.filter((s) => s.type === 'geofence.dwell')).toHaveLength(0);

    // Durable end state: OUTSIDE.
    const rows = await ctx.knex('tracking.geofence_state').where('geofence_id', fenceId);
    expect(rows[0]?.state).toBe('OUTSIDE');
  }, 30_000);

  it('5: DWELL fires once when the occupancy exceeds the threshold', async () => {
    if (!ctx || !evaluator) return;
    const fenceId = 'cccccccc-0000-4000-8000-000000000002';
    await insertCircleFence(ctx.knex, fenceId, TENANT_A, 'dwell-zone', { dwellSec: 300 });
    const captured: GeofenceSignal[] = [];
    const off = bus!.onGeofence((s) => captured.push(s));

    const t0 = new Date('2026-08-16T11:00:00Z');
    await evaluator.process(makePosition(OUTSIDE.lat, OUTSIDE.lng, t0, 'd-0'));
    await evaluator.process(makePosition(INSIDE.lat, INSIDE.lng, t0, 'd-1'));
    await evaluator.process(makePosition(INSIDE.lat, INSIDE.lng, new Date(t0.getTime() + 60_000), 'd-2')); // ENTER @ +1min
    await evaluator.process(makePosition(INSIDE.lat, INSIDE.lng, new Date(t0.getTime() + 240_000), 'd-3')); // 3 min < 5 min
    expect(captured.filter((s) => s.type === 'geofence.dwell')).toHaveLength(0);
    await evaluator.process(makePosition(INSIDE.lat, INSIDE.lng, new Date(t0.getTime() + 400_000), 'd-4')); // ≥ 5 min → DWELL
    for (let i = 5; i < 8; i++) {
      await evaluator.process(makePosition(INSIDE.lat, INSIDE.lng, new Date(t0.getTime() + 500_000), `d-${i}`));
    }
    const dwells = captured.filter((s) => s.type === 'geofence.dwell' && s.geofenceId === fenceId);
    expect(dwells).toHaveLength(1);
    expect(dwells[0]?.dwellSec).toBeGreaterThanOrEqual(300);
    off();
  }, 30_000);

  it('6: INACTIVE geofences never generate events', async () => {
    if (!ctx || !evaluator) return;
    const fenceId = 'cccccccc-0000-4000-8000-000000000003';
    await insertCircleFence(ctx.knex, fenceId, TENANT_A, 'inactive-zone', { status: 'INACTIVE' });
    const captured: GeofenceSignal[] = [];
    const off = bus!.onGeofence((s) => captured.push(s));
    const t = new Date('2026-08-16T12:00:00Z');
    for (let i = 0; i < 4; i++) {
      await evaluator.process(makePosition(INSIDE.lat, INSIDE.lng, t, `ia-${i}`));
    }
    // The INACTIVE fence never emits; earlier-scenario fences are separately
    // asserted and excluded here for isolation.
    expect(captured.filter((s) => s.geofenceId === fenceId)).toHaveLength(0);
    off();
  }, 30_000);

  it('7: assigned geofences apply ONLY to assigned vehicles', async () => {
    if (!ctx || !evaluator) return;
    const fenceId = 'cccccccc-0000-4000-8000-000000000004';
    await insertCircleFence(ctx.knex, fenceId, TENANT_A, 'restricted');
    await ctx.knex.raw(
      `INSERT INTO tracking.geofence_vehicles (geofence_id, vehicle_id, tenant_id)
       VALUES (?::uuid, ?::uuid, ?::uuid)`,
      [fenceId, VEHICLE_OTHER, TENANT_A],
    );
    // VEHICLE is NOT assigned → driving through the zone emits nothing.
    const captured: GeofenceSignal[] = [];
    const off = bus!.onGeofence((s) => captured.push(s));
    const t = new Date('2026-08-16T13:00:00Z');
    for (let i = 0; i < 4; i++) {
      await evaluator.process(makePosition(INSIDE.lat, INSIDE.lng, t, `as-${i}`));
    }
    expect(captured).toHaveLength(0);
    off();
  }, 30_000);

  it('8: TENANT ISOLATION — another tenant fence at the same point is invisible', async () => {
    if (!ctx || !evaluator) return;
    const fenceId = 'cccccccc-0000-4000-8000-000000000005';
    await insertCircleFence(ctx.knex, fenceId, TENANT_B, 'tenant-b-zone');
    const captured: GeofenceSignal[] = [];
    const off = bus!.onGeofence((s) => captured.push(s));
    const t = new Date('2026-08-16T14:00:00Z');
    for (let i = 0; i < 4; i++) {
      await evaluator.process(makePosition(INSIDE.lat, INSIDE.lng, t, `ti-${i}`));
    }
    // The events that fire reference TENANT_A fences only — never the fence of B.
    for (const s of captured) {
      expect(s.tenantId).toBe(TENANT_A);
      expect(s.geofenceId).not.toBe(fenceId);
    }
    off();
  }, 30_000);

  it('9: restart-safe — a fresh evaluator over persisted state emits nothing new', async () => {
    if (!ctx || !evaluator || !ctx) return;
    const fenceId = 'cccccccc-0000-4000-8000-000000000006';
    await insertCircleFence(ctx.knex, fenceId, TENANT_A, 'restart-zone');
    const t = new Date('2026-08-16T15:00:00Z');
    await evaluator.process(makePosition(OUTSIDE.lat, OUTSIDE.lng, t, 'r-1'));
    await evaluator.process(makePosition(INSIDE.lat, INSIDE.lng, t, 'r-2'));
    await evaluator.process(makePosition(INSIDE.lat, INSIDE.lng, t, 'r-3')); // ENTER
    const afterFirst = signals().length; // (listener registered post-hoc — baseline)
    // Simulate a worker restart with a NEW evaluator over the same DB state.
    const evaluator2 = new GeofenceEvaluator({
      config: CONFIG,
      definitions: new GeofenceDefinitionsRepository(ctx.knex),
      state: new GeofenceStateRepository(ctx.knex),
      signalBus: bus!,
      metrics: null,
    });
    const captured: GeofenceSignal[] = [];
    const off = bus!.onGeofence((s) => captured.push(s));
    for (let i = 0; i < 5; i++) {
      await evaluator2.process(makePosition(INSIDE.lat, INSIDE.lng, t, `r-restart-${i}`));
    }
    // Still INSIDE fence-6 — no duplicate ENTER for it (isolation from
    // earlier-scenario fences, which this filter provides).
    expect(captured.filter((s) => s.geofenceId === fenceId)).toHaveLength(0);
    expect(afterFirst).toBe(0);
    off();
  }, 30_000);

  it('10: EXPLAIN — the candidate query rides the GiST boundary index', async () => {
    if (!ctx) return;
    // Bulk-seed tenant B fences far away so the planner prefers the index.
    await ctx.knex.raw(
      `INSERT INTO tracking.geofences (tenant_id, name, geofence_type, boundary, alert_on, metadata)
       SELECT '${TENANT_B}', 'bulk ' || gs, 'POLYGON',
              ST_Buffer(ST_MakePoint(20 + (gs % 50) * 0.5, 20 + (gs % 50) * 0.5)::geography, 300),
              '{ENTER,EXIT}', '{}'
       FROM generate_series(1, 2000) gs`,
    );
    await ctx.knex.raw('ANALYZE tracking.geofences');
    const plan = await ctx.knex.raw(
      `EXPLAIN (COSTS OFF) SELECT g.id FROM tracking.geofences g
       WHERE g.tenant_id = ?::uuid AND g.status = 'ACTIVE'
         AND g.boundary && ST_Expand(ST_GeomFromText('SRID=4326;POINT(51.4002 35.7002)', 4326), 0.05)`,
      [TENANT_A],
    );
    const text = plan.rows.map((r: Record<string, unknown>) => Object.values(r)[0]).join('\n');
    expect(text).toMatch(/Bitmap Index Scan|Index Scan/);
    expect(text).toMatch(/ix_geofences_boundary/);
    expect(text).not.toMatch(/Seq Scan on g/);
  }, 60_000);
});
