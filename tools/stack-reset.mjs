#!/usr/bin/env node
/**
 * Wipe Docker volumes + bring the stack up + run demo seed.
 *
 * ⚠️  Destructive: deletes ALL persisted stack data (Postgres, Redis, …).
 *     Use only when you want a clean slate. For normal restarts use:
 *       pnpm stack:down && pnpm stack:up    (data preserved)
 *       pnpm seed:demo                      (re-import telemetry only)
 *
 * Usage:
 *   pnpm stack:reset
 *   SEED_COUNT=20 pnpm stack:reset
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = [
  'compose',
  '--project-name',
  'fleetvision',
  '-f',
  'infra/docker/docker-compose.yml',
  '--env-file',
  'infra/docker/.env',
];
const PG = process.env.PG_CONTAINER ?? 'fleetvision-postgres';
const TENANT_NAME = process.env.SEED_TENANT_NAME ?? 'FleetVision';

function log(msg) {
  console.log(msg);
}

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

function compose(args, inherit = false) {
  const r = spawnSync('docker', [...COMPOSE, ...args], {
    cwd: ROOT,
    stdio: inherit ? 'inherit' : 'pipe',
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    fail(`docker ${[...COMPOSE, ...args].join(' ')}\n${r.stderr ?? r.stdout ?? ''}`);
  }
  return r.stdout ?? '';
}

function dockerExecSoft(args) {
  const r = spawnSync('docker', args, { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return (r.stdout ?? '').trim();
}

async function waitForTenant(maxSec = 180) {
  log(`→ waiting for tenant "${TENANT_NAME}" (bootstrap seed)`);
  const deadline = Date.now() + maxSec * 1000;
  while (Date.now() < deadline) {
    const out = dockerExecSoft([
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
    if (out && /^[0-9a-f-]{36}$/i.test(out)) {
      log(`✓ tenant ready (${out})`);
      return;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  fail(`tenant "${TENANT_NAME}" not found after ${maxSec}s — check identity logs`);
}

async function main() {
  log('\n══ FleetVision stack:reset (WIPE + UP + SEED) ══');
  log('⚠️  This removes Docker volumes — all DB data will be deleted.\n');

  log('→ docker compose down --volumes');
  compose(['down', '--volumes'], true);

  log('→ docker compose up (phased)');
  const up = spawnSync('pnpm', ['stack:up'], { cwd: ROOT, stdio: 'inherit' });
  if (up.status !== 0) fail('stack:up failed');

  await waitForTenant();

  log('→ pnpm seed:demo');
  const seed = spawnSync('pnpm', ['seed:demo'], {
    cwd: ROOT,
    env: { ...process.env, SEED_WAIT_ATTEMPTS: '90' },
    stdio: 'inherit',
  });
  if (seed.status !== 0) fail('seed:demo failed');

  log('\n✓ stack:reset complete\n');
}

main().catch((err) => fail(err.message ?? String(err)));
