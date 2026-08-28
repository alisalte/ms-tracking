#!/usr/bin/env node
/**
 * Backfill ~1 month of tracking history for vehicles already in the tenant.
 * Does not create fleets/vehicles/devices (unlike seed:demo).
 *
 * Usage:  SEED_DAYS=30 node tools/seed-history-existing.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TENANT_NAME = process.env.SEED_TENANT_NAME ?? 'FleetVision';
const DAYS = Math.max(1, Number(process.env.SEED_DAYS ?? 30) || 30);
const PG = process.env.PG_CONTAINER ?? 'fleetvision-postgres';
const CSV_HOST = join(ROOT, '.tmp', 'csv');
const CSV_TMP = '/tmp/csv';
const SEED_JSON = '/tmp/fleet-seed.json';

function log(msg) {
  console.log(msg);
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function dockerExec(args, opts = {}) {
  const r = spawnSync('docker', args, {
    encoding: 'utf8',
    ...opts,
  });
  if (r.status !== 0) {
    fail(`docker ${args.join(' ')} failed:\n${r.stderr || r.stdout}`);
  }
  return (r.stdout ?? '').trim();
}

function resolveTenantId() {
  const out = dockerExec([
    'exec',
    PG,
    'psql',
    '-U',
    'fleetvision',
    '-d',
    'fleetvision',
    '-tAc',
    `SELECT id FROM iam.tenants WHERE name='${TENANT_NAME.replace(/'/g, "''")}' LIMIT 1;`,
  ]);
  if (!/^[0-9a-f-]{36}$/i.test(out)) {
    fail(`tenant "${TENANT_NAME}" not found in Postgres (got: ${JSON.stringify(out)})`);
  }
  return out;
}

function exportFleetSeed(tenantId) {
  log('→ exporting existing vehicles to /tmp/fleet-seed.json');
  const sql = `
SELECT COALESCE(json_agg(t ORDER BY t.idx), '[]'::json)
FROM (
  SELECT
    (row_number() OVER (ORDER BY v.created_at, v.id) - 1)::int AS idx,
    f.code AS "fleetCode",
    f.id AS "fleetId",
    f.name AS "fleetName",
    v.id AS "vehicleId",
    v.name AS "vehicleName",
    v.plate,
    'VAN'::text AS "vehicleType",
    d.id AS "deviceId",
    d.imei,
    d.model AS "deviceModel"
  FROM fleet.vehicles v
  JOIN fleet.fleets f ON f.id = v.fleet_id
  JOIN fleet.vehicle_devices vd ON vd.vehicle_id = v.id
  JOIN fleet.devices d ON d.id = vd.device_id
  WHERE v.tenant_id = '${tenantId}'::uuid
    AND v.status = 'ACTIVE'
) t;`.trim();

  const json = dockerExec([
    'exec',
    PG,
    'psql',
    '-U',
    'fleetvision',
    '-d',
    'fleetvision',
    '-tAc',
    sql,
  ]);
  let fleet;
  try {
    fleet = JSON.parse(json);
  } catch {
    fail(`could not parse vehicle export (got: ${json.slice(0, 200)})`);
  }
  if (!Array.isArray(fleet) || fleet.length === 0) {
    fail('no bound ACTIVE vehicles found for this tenant');
  }
  writeFileSync(SEED_JSON, JSON.stringify(fleet));
  log(`✓ ${fleet.length} bound vehicles exported`);
  return fleet.length;
}

function clearTracking(tenantId) {
  log('→ clearing previous tracking rows for tenant');
  dockerExec([
    'exec',
    PG,
    'psql',
    '-U',
    'fleetvision',
    '-d',
    'fleetvision',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `SET app.current_tenant_id = '${tenantId}';
     DELETE FROM tracking.vehicle_positions WHERE tenant_id = '${tenantId}'::uuid;
     DELETE FROM tracking.trip_events WHERE tenant_id = '${tenantId}'::uuid;
     DELETE FROM tracking.parking_periods WHERE tenant_id = '${tenantId}'::uuid;
     DELETE FROM tracking.idle_periods WHERE tenant_id = '${tenantId}'::uuid;
     DELETE FROM tracking.engine_hours WHERE tenant_id = '${tenantId}'::uuid;
     DELETE FROM tracking.device_status WHERE tenant_id = '${tenantId}'::uuid;`,
  ]);
}

function importHistory(tenantId) {
  clearTracking(tenantId);

  mkdirSync(CSV_HOST, { recursive: true });
  cpSync(CSV_TMP, CSV_HOST, { recursive: true });

  dockerExec(['exec', PG, 'mkdir', '-p', '/tmp/csv']);
  execFileSync('docker', ['cp', `${CSV_HOST}/.`, `${PG}:/tmp/csv/`], { stdio: 'inherit' });

  const sqlTemplate = readFileSync(join(ROOT, 'tools/import-history.sql'), 'utf8');
  const sql = sqlTemplate.replace(
    /SET app\.current_tenant_id = '[^']+';/,
    `SET app.current_tenant_id = '${tenantId}';`,
  );
  const sqlHost = join(ROOT, '.tmp', 'import-history.sql');
  writeFileSync(sqlHost, sql);
  execFileSync('docker', ['cp', sqlHost, `${PG}:/tmp/import-history.sql`], { stdio: 'inherit' });

  log('→ importing CSVs into Postgres');
  const r = spawnSync(
    'docker',
    [
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
      '/tmp/import-history.sql',
    ],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) fail('import-history.sql failed');
}

function main() {
  log(`\n══ Seed history for existing fleet (${DAYS} days) ══\n`);
  const tenantId = resolveTenantId();
  log(`✓ tenant ${TENANT_NAME} → ${tenantId}`);

  const count = exportFleetSeed(tenantId);

  log(`→ node tools/generate-history.mjs --days ${DAYS}`);
  const r = spawnSync(
    process.execPath,
    [join(ROOT, 'tools/generate-history.mjs'), '--days', String(DAYS)],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        SEED_TENANT_ID: tenantId,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--max-old-space-size=4096']
          .filter(Boolean)
          .join(' '),
      },
      stdio: 'inherit',
    },
  );
  if (r.status !== 0) fail(`generate-history exited ${r.status}`);

  importHistory(tenantId);

  const summary = dockerExec([
    'exec',
    PG,
    'psql',
    '-U',
    'fleetvision',
    '-d',
    'fleetvision',
    '-tAc',
    `SET app.current_tenant_id = '${tenantId}';
     SELECT 'vehicles=' || ${count}
       || ' positions=' || (SELECT count(*) FROM tracking.vehicle_positions WHERE tenant_id = '${tenantId}'::uuid)
       || ' trips=' || (SELECT count(*) FROM tracking.trip_events WHERE tenant_id = '${tenantId}'::uuid)
       || ' parking=' || (SELECT count(*) FROM tracking.parking_periods WHERE tenant_id = '${tenantId}'::uuid);`,
  ]);

  log(`\n✓ done — ${summary}`);
  log('  UI: http://localhost:8080  (map / trips / reports)\n');
}

main();
