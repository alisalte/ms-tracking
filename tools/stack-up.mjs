#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
/**
 * Phased `docker compose up` — infra first, then app services.
 *
 * Avoids identity (and other services) failing health on cold boot when
 * Postgres reports pg_isready before it accepts application TCP connections.
 *
 *   pnpm stack:up         start only (existing images, no docker build)
 *   pnpm stack:up:build   rebuild images whose source changed, then start
 *   node tools/stack-up.mjs build   same as stack:up:build
 *
 * Named volumes (Postgres/Redis) are never removed here. Wipe only with
 * `pnpm stack:reset` (compose down --volumes).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAMP_DIR = join(ROOT, '.cache');
const STAMP_FILE = join(STAMP_DIR, 'stack-build-stamps.json');
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

/** Compose service → app directory (repo-relative). Infra images are skipped. */
const APP_SERVICES = {
  'identity-service': 'apps/identity-service',
  'fleet-management-service': 'apps/fleet-management-service',
  'fleet-service': 'apps/fleet-service',
  'gps-engine-service': 'apps/gps-engine-service',
  'notification-service': 'apps/notification-service',
  'reporting-service': 'apps/reporting-service',
  'device-gateway-service': 'apps/device-gateway-service',
  'mdvr-streamer-service': 'apps/mdvr-streamer-service',
  'media-service': 'apps/media-service',
  'web-dashboard': 'apps/web-dashboard',
  'map-engine': 'apps/map-engine-service',
};

const SHARED_FILES = [
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'package.json',
  'tsconfig.base.json',
  'tsconfig.json',
  '.npmrc',
  '.dockerignore',
  'biome.json',
];

const SKIP_DIR = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  '__tests__',
  'e2e',
  'build',
  '.cache',
  '.results',
]);

const argv = process.argv.slice(2);
const WANT_BUILD = argv.includes('--build') || argv.includes('build');

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
  return r;
}

function dockerOk(args) {
  const r = spawnSync('docker', args, { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout ?? '').trim() : null;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadNameToDir() {
  const map = new Map();
  for (const group of ['apps', 'packages']) {
    const groupDir = join(ROOT, group);
    if (!existsSync(groupDir)) continue;
    for (const name of readdirSync(groupDir)) {
      const pkgPath = join(groupDir, name, 'package.json');
      if (!existsSync(pkgPath)) continue;
      map.set(readJson(pkgPath).name, join(group, name));
    }
  }
  return map;
}

function workspaceClosure(appRel) {
  const nameToDir = loadNameToDir();
  const dirs = new Set([appRel]);
  const queue = [appRel];
  while (queue.length > 0) {
    const dir = queue.pop();
    const pkgPath = join(ROOT, dir, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = readJson(pkgPath);
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const [dep, ver] of Object.entries(deps)) {
      if (!String(ver).startsWith('workspace:')) continue;
      const rel = nameToDir.get(dep);
      if (rel && !dirs.has(rel)) {
        dirs.add(rel);
        queue.push(rel);
      }
    }
  }
  return dirs;
}

function shouldSkipFile(name) {
  return (
    name.endsWith('.spec.ts') ||
    name.endsWith('.spec.tsx') ||
    name.endsWith('.test.ts') ||
    name.endsWith('.test.tsx') ||
    name.endsWith('.md')
  );
}

function collectFiles(relDir, out) {
  const abs = join(ROOT, relDir);
  if (!existsSync(abs)) return;
  const st = statSync(abs);
  if (st.isFile()) {
    out.push(relDir.replaceAll('\\', '/'));
    return;
  }
  for (const ent of readdirSync(abs, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (SKIP_DIR.has(ent.name)) continue;
      collectFiles(join(relDir, ent.name), out);
    } else if (ent.isFile()) {
      if (shouldSkipFile(ent.name)) continue;
      out.push(join(relDir, ent.name).replaceAll('\\', '/'));
    }
  }
}

function fingerprint(service, appRel) {
  const files = [];
  collectFiles(appRel, files);
  for (const dep of workspaceClosure(appRel)) {
    if (dep === appRel) continue;
    collectFiles(dep, files);
  }
  for (const shared of SHARED_FILES) {
    if (existsSync(join(ROOT, shared))) files.push(shared);
  }
  const unique = [...new Set(files)].sort();
  const h = createHash('sha256');
  h.update(service);
  for (const rel of unique) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    const st = statSync(abs);
    h.update(rel);
    h.update('\0');
    h.update(String(st.size));
    h.update('\0');
    h.update(readFileSync(abs));
  }
  return h.digest('hex');
}

function loadStamps() {
  try {
    return readJson(STAMP_FILE);
  } catch {
    return {};
  }
}

function saveStamps(stamps) {
  mkdirSync(STAMP_DIR, { recursive: true });
  writeFileSync(STAMP_FILE, `${JSON.stringify(stamps, null, 2)}\n`);
}

function hasImage(service) {
  const r = spawnSync('docker', [...COMPOSE, 'images', '-q', service], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return r.status === 0 && Boolean((r.stdout ?? '').trim());
}

function rebuildChanged() {
  const stamps = loadStamps();
  const changed = [];
  const fingerprints = {};
  console.log('→ checking which app images changed');
  for (const [service, appRel] of Object.entries(APP_SERVICES)) {
    const fp = fingerprint(service, appRel);
    fingerprints[service] = fp;
    const missing = !hasImage(service);
    const dirty = stamps[service] !== fp;
    if (missing || dirty) {
      const why =
        missing && dirty ? 'no image + source changed' : missing ? 'no image' : 'source changed';
      console.log(`  • ${service} — rebuild (${why})`);
      changed.push(service);
    } else {
      console.log(`  • ${service} — up to date`);
    }
  }
  if (changed.length === 0) {
    console.log('→ images up to date — skip docker build\n');
    return;
  }
  console.log(`\n→ docker compose build (${changed.length}): ${changed.join(', ')}`);
  compose(['build', ...changed], true);
  saveStamps({ ...stamps, ...Object.fromEntries(changed.map((s) => [s, fingerprints[s]])) });
  console.log('✓ images rebuilt\n');
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
  console.log(
    '\n⚠ identity not ready yet — it may still be restarting (docker logs fleetvision-identity)',
  );
}

async function main() {
  const mode = WANT_BUILD ? 'stack:up:build' : 'stack:up';
  console.log(`\n══ FleetVision ${mode} (phased) ══\n`);
  if (WANT_BUILD) {
    rebuildChanged();
  } else {
    console.log('→ start only (no docker build) — changed images: pnpm stack:up:build\n');
  }
  console.log('→ infra: postgres, redis, zookeeper, kafka');
  compose(['up', '-d', ...INFRA], true);
  await waitPostgres();
  console.log('→ all services');
  compose(['up', '-d'], true);
  await waitIdentity();
  console.log('\n✓ stack up — UI: http://localhost:8080  dev: pnpm dev:web\n');
}

main().catch((err) => fail(err.message ?? String(err)));
