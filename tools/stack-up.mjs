#!/usr/bin/env node
/**
 * Phased `docker compose up` — infra first, then app services.
 *
 * Avoids identity (and other services) failing health on cold boot when
 * Postgres reports pg_isready before it accepts application TCP connections.
 *
 * Usage: pnpm stack:up
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
const INFRA = ['postgres', 'redis', 'zookeeper', 'kafka'];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
    fail(`docker compose ${args.join(' ')}\n${r.stderr ?? r.stdout ?? ''}`);
  }
}

function dockerOk(args) {
  const r = spawnSync('docker', args, { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout ?? '').trim() : null;
}

async function waitPostgres(maxSec = 120) {
  process.stdout.write('→ waiting for postgres');
  const deadline = Date.now() + maxSec * 1000;
  while (Date.now() < deadline) {
    // TCP probe — Unix-socket pg_isready can pass while :5432 is still down.
    const ready = dockerOk([
      'exec',
      PG,
      'pg_isready',
      '-h',
      '127.0.0.1',
      '-U',
      'fleetvision',
      '-d',
      'fleetvision',
    ]);
    if (ready !== null) {
      console.log('\n✓ postgres ready');
      return;
    }
    process.stdout.write('.');
    await sleep(2000);
  }
  fail('\npostgres not ready — check: docker logs fleetvision-postgres');
}

async function waitIdentity(maxSec = 180) {
  const base = process.env.SEED_IDENTITY_BASE?.replace(/\/api\/v1$/, '') ?? 'http://localhost:3000';
  process.stdout.write('→ waiting for identity /health/ready');
  const deadline = Date.now() + maxSec * 1000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/health/ready`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        console.log('\n✓ identity ready');
        return;
      }
    } catch {
      /* warming up */
    }
    process.stdout.write('.');
    await sleep(3000);
  }
  console.log('\n⚠ identity not ready yet — it may still be restarting (docker logs fleetvision-identity)');
}

async function main() {
  console.log('\n══ FleetVision stack:up (phased) ══\n');
  console.log('→ infra: postgres, redis, zookeeper, kafka');
  compose(['up', '-d', ...INFRA], true);
  await waitPostgres();
  console.log('→ all services');
  compose(['up', '-d'], true);
  await waitIdentity();
  console.log('\n✓ stack up — UI: http://localhost:8080  dev: pnpm dev:web\n');
}

main().catch((err) => fail(err.message ?? String(err)));
