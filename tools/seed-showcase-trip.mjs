#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
/**
 * Insert one detailed Tehran test trip (movement, speed, stops, idle,
 * overspeed) so /trips replay can show everything on the map.
 *
 * Re-runnable: deletes the previous showcase rows first.
 *
 * Usage:  node tools/seed-showcase-trip.mjs
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PG = process.env.PG_CONTAINER ?? 'fleetvision-postgres';
const TENANT_NAME = process.env.SEED_TENANT_NAME ?? 'FleetVision';
const SHOWCASE = 'tehran-route-v1';
const TRIP_SOURCE = 'a11ce000-5e8d-4000-a000-00000000c0de';

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function dockerExec(args) {
  const r = spawnSync('docker', args, { encoding: 'utf8' });
  if (r.status !== 0) fail(`docker ${args.join(' ')} failed:\n${r.stderr || r.stdout}`);
  return (r.stdout ?? '').trim();
}

function psql(sql) {
  return dockerExec([
    'exec',
    PG,
    'psql',
    '-U',
    'fleetvision',
    '-d',
    'fleetvision',
    '-v',
    'ON_ERROR_STOP=1',
    '-tAc',
    sql,
  ]);
}

const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

function bearing(lat1, lng1, lat2, lng2) {
  const la1 = toRad(lat1);
  const la2 = toRad(lat2);
  const dlo = toRad(lng2 - lng1);
  const y = Math.sin(dlo) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dlo);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function haversine(lat1, lng1, lat2, lng2) {
  const dLa = toRad(lat2 - lat1);
  const dLo = toRad(lng2 - lng1);
  const a =
    Math.sin(dLa / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

const PLACES = {
  azadi: { name: 'میدان آزادی', lat: 35.6997, lng: 51.3378 },
  enghelab: { name: 'میدان انقلاب', lat: 35.7012, lng: 51.391 },
  vanak: { name: 'میدان ونک', lat: 35.7572, lng: 51.4105 },
  jordan: { name: 'جردن', lat: 35.773, lng: 51.418 },
  tajrish: { name: 'تجریش', lat: 35.8044, lng: 51.4342 },
};

function addStationary(
  out,
  { lat, lng, heading, speed, ignition, fromMs, durationS, stepS, phase },
) {
  const n = Math.max(1, Math.round(durationS / stepS));
  for (let i = 0; i <= n; i++) {
    out.push({
      t: fromMs + i * stepS * 1000,
      lat,
      lng,
      heading,
      speed,
      ignition,
      phase,
    });
  }
  return fromMs + durationS * 1000;
}

function addDrive(out, from, to, { fromMs, cruiseKmh, jitter = 8, overspeed = false, stepS = 20 }) {
  const distM = haversine(from.lat, from.lng, to.lat, to.lng);
  let durationS = Math.max(stepS * 4, (distM / 1000 / Math.max(cruiseKmh, 8)) * 3600);
  if (overspeed) {
    durationS = Math.max(3 * 60, durationS);
    stepS = 10;
  }
  const n = Math.max(overspeed ? 12 : 4, Math.round(durationS / stepS));
  const brg = bearing(from.lat, from.lng, to.lat, to.lng);
  let t = fromMs;
  for (let i = 1; i <= n; i++) {
    const frac = i / n;
    const wobble = Math.sin(i * 1.7) * 0.00018;
    let speed = cruiseKmh + Math.sin(i / 3) * jitter;
    if (overspeed) speed = cruiseKmh + Math.abs(Math.sin(i / 2)) * 6;
    if (!overspeed && i <= 2) speed = Math.min(speed, 35);
    if (!overspeed && i >= n - 1) speed = Math.min(speed, 28);
    t += stepS * 1000;
    out.push({
      t,
      lat: lerp(from.lat, to.lat, frac) + wobble,
      lng: lerp(from.lng, to.lng, frac) + wobble * 0.6,
      heading: brg,
      speed: Math.max(0, speed),
      ignition: true,
      phase: overspeed ? 'overspeed' : 'drive',
    });
  }
  return t;
}

function windowOf(samples, phase) {
  const hit = samples.filter((s) => s.phase === phase);
  if (hit.length === 0) return null;
  return { from: hit[0].t, to: hit[hit.length - 1].t, lat: hit[0].lat, lng: hit[0].lng };
}

function buildSamples(startMs) {
  const samples = [];
  let t = startMs;
  const h0 = bearing(PLACES.azadi.lat, PLACES.azadi.lng, PLACES.enghelab.lat, PLACES.enghelab.lng);

  t = addStationary(samples, {
    lat: PLACES.azadi.lat,
    lng: PLACES.azadi.lng,
    heading: h0,
    speed: 0,
    ignition: true,
    fromMs: t,
    durationS: 4 * 60,
    stepS: 30,
    phase: 'idle-azadi',
  });

  t = addDrive(samples, PLACES.azadi, PLACES.enghelab, { fromMs: t, cruiseKmh: 38, jitter: 10 });

  t = addStationary(samples, {
    lat: PLACES.enghelab.lat,
    lng: PLACES.enghelab.lng,
    heading: bearing(PLACES.enghelab.lat, PLACES.enghelab.lng, PLACES.vanak.lat, PLACES.vanak.lng),
    speed: 0,
    ignition: false,
    fromMs: t,
    durationS: 8 * 60,
    stepS: 40,
    phase: 'stop-enghelab',
  });

  t = addDrive(samples, PLACES.enghelab, PLACES.vanak, { fromMs: t, cruiseKmh: 62, jitter: 8 });

  t = addDrive(samples, PLACES.vanak, PLACES.jordan, {
    fromMs: t,
    cruiseKmh: 112,
    jitter: 4,
    overspeed: true,
    stepS: 15,
  });

  t = addStationary(samples, {
    lat: PLACES.jordan.lat,
    lng: PLACES.jordan.lng,
    heading: bearing(PLACES.jordan.lat, PLACES.jordan.lng, PLACES.tajrish.lat, PLACES.tajrish.lng),
    speed: 0,
    ignition: true,
    fromMs: t,
    durationS: 6 * 60,
    stepS: 30,
    phase: 'idle-jordan',
  });

  t = addDrive(samples, PLACES.jordan, PLACES.tajrish, { fromMs: t, cruiseKmh: 88, jitter: 5 });

  t = addStationary(samples, {
    lat: PLACES.tajrish.lat,
    lng: PLACES.tajrish.lng,
    heading: 10,
    speed: 0,
    ignition: false,
    fromMs: t,
    durationS: 12 * 60,
    stepS: 40,
    phase: 'stop-tajrish',
  });

  return samples;
}

function sqlStr(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

function main() {
  console.log('\n══ Seed showcase trip (Tehran test route) ══\n');
  const tenantId = psql(`SELECT id FROM iam.tenants WHERE name=${sqlStr(TENANT_NAME)} LIMIT 1;`);
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) fail(`tenant "${TENANT_NAME}" not found`);
  console.log(`✓ tenant ${tenantId}`);

  const row =
    psql(`
    SET app.current_tenant_id = '${tenantId}';
    SELECT v.id || ',' || d.id || ',' || coalesce(v.name,'') || ',' || coalesce(v.plate,'')
    FROM fleet.vehicles v
    JOIN fleet.vehicle_devices vd ON vd.vehicle_id = v.id
    JOIN fleet.devices d ON d.id = vd.device_id
    WHERE v.tenant_id = '${tenantId}'::uuid AND v.status = 'ACTIVE'
    ORDER BY v.name
    LIMIT 1;
  `)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && line !== 'SET')
      .at(-1) ?? '';
  const [vehicleId, deviceId, vehicleName, plate] = row.split(',');
  if (!vehicleId || !deviceId) fail('no ACTIVE bound vehicle');
  console.log(`✓ vehicle ${vehicleName} ${plate}`.trim());

  const startMs = Date.now() - 8 * 60_000 - 95 * 60_000;
  const samples = buildSamples(startMs);
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) fail('no samples');
  const idleAzadi = windowOf(samples, 'idle-azadi');
  const idleJordan = windowOf(samples, 'idle-jordan');
  const stopEnghelab = windowOf(samples, 'stop-enghelab');
  const stopTajrish = windowOf(samples, 'stop-tajrish');
  if (!idleAzadi || !idleJordan || !stopEnghelab || !stopTajrish) fail('phase windows missing');
  let distM = 0;
  let maxSpeed = 0;
  let odo = 12450;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    distM += haversine(a.lat, a.lng, b.lat, b.lng);
    maxSpeed = Math.max(maxSpeed, b.speed);
  }
  const durationS = Math.round((last.t - first.t) / 1000);
  const tripId = randomUUID();
  const idleId = randomUUID();
  const idle2Id = randomUUID();
  const park1Id = randomUUID();
  const park2Id = randomUUID();

  const posValues = samples
    .map((s, i) => {
      if (i > 0) odo += haversine(samples[i - 1].lat, samples[i - 1].lng, s.lat, s.lng) / 1000;
      const ts = new Date(s.t).toISOString();
      return `(${sqlStr(randomUUID())}::uuid, '${vehicleId}'::uuid, '${tenantId}'::uuid,
        '${ts}'::timestamptz, now(),
        ST_SetSRID(ST_MakePoint(${s.lng}, ${s.lat}), 4326)::geography,
        ${s.lat}, ${s.lng}, 1180, ${s.heading.toFixed(1)}, ${s.speed.toFixed(1)},
        8.5, ${odo.toFixed(3)}, ${s.ignition}, '${deviceId}'::uuid, 1, NULL,
        '{"showcase":"${SHOWCASE}"}'::jsonb)`;
    })
    .join(',\n');

  const sql = `
SET app.current_tenant_id = '${tenantId}';

DELETE FROM tracking.vehicle_positions
 WHERE tenant_id = '${tenantId}'::uuid AND metadata->>'showcase' = '${SHOWCASE}';
DELETE FROM tracking.vehicle_positions
 WHERE tenant_id = '${tenantId}'::uuid AND vehicle_id = '${vehicleId}'::uuid
   AND captured_at BETWEEN '${new Date(first.t).toISOString()}'::timestamptz
                       AND '${new Date(last.t).toISOString()}'::timestamptz;
DELETE FROM tracking.trip_events
 WHERE tenant_id = '${tenantId}'::uuid AND source_event_id = '${TRIP_SOURCE}'::uuid;
DELETE FROM tracking.parking_periods
 WHERE tenant_id = '${tenantId}'::uuid AND source_event_id IN (
   '${TRIP_SOURCE}'::uuid, 'b11ce000-5e8d-4000-a000-00000000c0d1'::uuid, 'b11ce000-5e8d-4000-a000-00000000c0d2'::uuid
 );
DELETE FROM tracking.idle_periods
 WHERE tenant_id = '${tenantId}'::uuid AND source_event_id IN (
   'c11ce000-5e8d-4000-a000-00000000c0d1'::uuid, 'c11ce000-5e8d-4000-a000-00000000c0d2'::uuid
 );
DELETE FROM tracking.idle_periods
 WHERE tenant_id = '${tenantId}'::uuid AND vehicle_id = '${vehicleId}'::uuid
   AND started_at BETWEEN '${new Date(first.t).toISOString()}'::timestamptz
                      AND '${new Date(last.t).toISOString()}'::timestamptz;
DELETE FROM tracking.parking_periods
 WHERE tenant_id = '${tenantId}'::uuid AND vehicle_id = '${vehicleId}'::uuid
   AND started_at BETWEEN '${new Date(first.t).toISOString()}'::timestamptz
                      AND '${new Date(last.t).toISOString()}'::timestamptz;

INSERT INTO tracking.vehicle_positions (
  event_id, vehicle_id, tenant_id, captured_at, ingested_at, geom, latitude, longitude,
  altitude_m, heading_deg, speed_kmh, accuracy_m, odometer_km, ignition_on, source_device,
  quality, session_id, metadata
) VALUES
${posValues};

INSERT INTO tracking.trip_events (
  id, tenant_id, vehicle_id, status, started_at, ended_at,
  start_lat, start_lng, end_lat, end_lng, distance_km, duration_s, max_speed_kmh,
  stop_count, created_at, updated_at, source_event_id
) VALUES (
  '${tripId}'::uuid, '${tenantId}'::uuid, '${vehicleId}'::uuid, 'COMPLETED',
  '${new Date(first.t).toISOString()}'::timestamptz,
  '${new Date(last.t).toISOString()}'::timestamptz,
  ${first.lat}, ${first.lng}, ${last.lat}, ${last.lng},
  ${(distM / 1000).toFixed(3)}, ${durationS}, ${maxSpeed.toFixed(1)}, 2,
  now(), now(), '${TRIP_SOURCE}'::uuid
);

INSERT INTO tracking.idle_periods (
  id, tenant_id, vehicle_id, started_at, ended_at, duration_s, alerted, created_at, source_event_id
) VALUES
  ('${idleId}'::uuid, '${tenantId}'::uuid, '${vehicleId}'::uuid,
   '${new Date(idleAzadi.from).toISOString()}'::timestamptz,
   '${new Date(idleAzadi.to).toISOString()}'::timestamptz,
   ${Math.round((idleAzadi.to - idleAzadi.from) / 1000)}, false, now(),
   'c11ce000-5e8d-4000-a000-00000000c0d1'::uuid),
  ('${idle2Id}'::uuid, '${tenantId}'::uuid, '${vehicleId}'::uuid,
   '${new Date(idleJordan.from).toISOString()}'::timestamptz,
   '${new Date(idleJordan.to).toISOString()}'::timestamptz,
   ${Math.round((idleJordan.to - idleJordan.from) / 1000)}, false, now(),
   'c11ce000-5e8d-4000-a000-00000000c0d2'::uuid);

INSERT INTO tracking.parking_periods (
  id, tenant_id, vehicle_id, status, started_at, ended_at, duration_s, lat, lng, created_at, source_event_id
) VALUES
  ('${park1Id}'::uuid, '${tenantId}'::uuid, '${vehicleId}'::uuid, 'ENDED',
   '${new Date(stopEnghelab.from).toISOString()}'::timestamptz,
   '${new Date(stopEnghelab.to).toISOString()}'::timestamptz,
   ${Math.round((stopEnghelab.to - stopEnghelab.from) / 1000)},
   ${stopEnghelab.lat}, ${stopEnghelab.lng}, now(),
   'b11ce000-5e8d-4000-a000-00000000c0d1'::uuid),
  ('${park2Id}'::uuid, '${tenantId}'::uuid, '${vehicleId}'::uuid, 'ENDED',
   '${new Date(stopTajrish.from).toISOString()}'::timestamptz,
   '${new Date(stopTajrish.to).toISOString()}'::timestamptz,
   ${Math.round((stopTajrish.to - stopTajrish.from) / 1000)},
   ${stopTajrish.lat}, ${stopTajrish.lng}, now(),
   'b11ce000-5e8d-4000-a000-00000000c0d2'::uuid);

SELECT 'positions=' || (SELECT count(*) FROM tracking.vehicle_positions
          WHERE metadata->>'showcase'='${SHOWCASE}')
    || ' trip=' || '${tripId}';
`;

  const sqlPath = join(ROOT, '.tmp', 'seed-showcase-trip.sql');
  mkdirSync(dirname(sqlPath), { recursive: true });
  writeFileSync(sqlPath, sql);
  dockerExec(['cp', sqlPath, `${PG}:/tmp/seed-showcase-trip.sql`]);
  const out = dockerExec([
    'exec',
    PG,
    'psql',
    '-U',
    'fleetvision',
    '-d',
    'fleetvision',
    '-v',
    'ON_ERROR_STOP=1',
    '-f',
    '/tmp/seed-showcase-trip.sql',
  ]);
  console.log(out.split('\n').filter(Boolean).at(-1));
  console.log(`\n✓ showcase trip ${tripId}`);
  console.log(`  UI: http://localhost:8080/trips/${tripId}\n`);
}

main();
