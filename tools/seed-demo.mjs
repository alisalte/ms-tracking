#!/usr/bin/env node
/**
 * One-shot demo seed: fleets + devices + vehicles + ~1 month telemetry.
 *
 * Prerequisites: `pnpm stack:up` (identity, fleet-management, postgres healthy).
 *
 * Usage:
 *   pnpm seed:demo
 *   SEED_COUNT=20 SEED_DAYS=30 pnpm seed:demo
 *
 * Env (optional):
 *   SEED_COUNT              vehicles/devices (default 10)
 *   SEED_DAYS               history window (default 30)
 *   SEED_ADMIN_EMAIL        default admin@fleetvision.local
 *   SEED_ADMIN_PASSWORD     default ChangeMe!StrongPass123
 *   SEED_TENANT_NAME        default FleetVision
 *   SEED_IDENTITY_BASE      default http://localhost:3000/api/v1
 *   SEED_API_BASE           default http://localhost:3006/api/v1
 *   PG_CONTAINER            default fleetvision-postgres
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IDENTITY = process.env.SEED_IDENTITY_BASE ?? 'http://localhost:3000/api/v1';
const API = process.env.SEED_API_BASE ?? 'http://localhost:3006/api/v1';
const EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@fleetvision.local';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!StrongPass123';
const TENANT_NAME = process.env.SEED_TENANT_NAME ?? 'FleetVision';
const COUNT = Math.max(1, Number(process.env.SEED_COUNT ?? 10) || 10);
const DAYS = Math.max(1, Number(process.env.SEED_DAYS ?? 30) || 30);
const PG = process.env.PG_CONTAINER ?? 'fleetvision-postgres';
const CSV_HOST = process.env.SEED_CSV_DIR ?? join(ROOT, '.tmp', 'csv');

function log(msg) {
  console.log(msg);
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function waitHealthy(url, label, attempts = Number(process.env.SEED_WAIT_ATTEMPTS ?? 30)) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        log(`✓ ${label} ready`);
        return;
      }
    } catch {
      /* retry */
    }
    if (i === attempts) fail(`${label} not reachable at ${url}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
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

function runNode(script, env) {
  log(`→ node ${script}`);
  const r = spawnSync(process.execPath, [join(ROOT, script)], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (r.status !== 0) fail(`${script} exited ${r.status}`);
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

async function main() {
  log(`\n══ FleetVision demo seed (${COUNT} vehicles, ${DAYS} days) ══\n`);

  await waitHealthy(`${IDENTITY.replace(/\/api\/v1$/, '')}/health/live`, 'identity');
  await waitHealthy(`${API.replace(/\/api\/v1$/, '')}/health/live`, 'fleet-management');

  const tenantId = resolveTenantId();
  log(`✓ tenant ${TENANT_NAME} → ${tenantId}`);

  const env = {
    SEED_TENANT_ID: tenantId,
    SEED_COUNT: String(COUNT),
    SEED_ADMIN_EMAIL: EMAIL,
    SEED_ADMIN_PASSWORD: PASSWORD,
    SEED_IDENTITY_BASE: IDENTITY,
    SEED_API_BASE: API,
  };

  runNode('tools/seed-fleet.mjs', env);

  {
    log(`→ node tools/generate-history.mjs --days ${DAYS}`);
    const r = spawnSync(
      process.execPath,
      [join(ROOT, 'tools/generate-history.mjs'), '--days', String(DAYS)],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          ...env,
          NODE_OPTIONS: [process.env.NODE_OPTIONS, '--max-old-space-size=4096']
            .filter(Boolean)
            .join(' '),
        },
        stdio: 'inherit',
      },
    );
    if (r.status !== 0) fail(`generate-history exited ${r.status}`);
  }

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
     SELECT 'devices=' || (SELECT count(*) FROM fleet.devices)
       || ' vehicles=' || (SELECT count(*) FROM fleet.vehicles)
       || ' positions=' || (SELECT count(*) FROM tracking.vehicle_positions)
       || ' trips=' || (SELECT count(*) FROM tracking.trip_events)
       || ' parking=' || (SELECT count(*) FROM tracking.parking_periods)
       || ' idle=' || (SELECT count(*) FROM tracking.idle_periods)
       || ' engine_hours=' || (SELECT count(*) FROM tracking.engine_hours);`,
  ]);

  log(`\n✓ done — ${summary}`);
  log(`  Login: tenant=${TENANT_NAME}  email=${EMAIL}`);
  log('  UI:    http://localhost:5173  or  http://localhost:8080\n');
}

main().catch((err) => {
  fail(err.message ?? String(err));
});
