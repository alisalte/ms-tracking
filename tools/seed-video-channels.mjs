#!/usr/bin/env node
/**
 * Register one MDVR video channel per seeded vehicle (via the real REST API,
 * same shape as the DeviceConfigWizard's "Live test" step), so the video
 * wall has real channels to list. Reads the mapping written by seed-fleet.mjs.
 *
 * Usage: node tools/seed-video-channels.mjs
 */
const API = process.env.SEED_API_BASE ?? 'http://localhost:3012';
const IDENTITY = process.env.SEED_IDENTITY_BASE ?? 'http://localhost:3000/api/v1';
const TENANT = process.env.SEED_TENANT_ID ?? '4193ef68-74c6-4d2d-8ce5-06dc2e06febf';
const EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@fleetvision.local';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!StrongPass123';

async function login() {
  const res = await fetch(`${IDENTITY}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': TENANT },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed ${res.status}: ${await res.text()}`);
  const { data } = await res.json();
  return data.access_token;
}

let token;
async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Tenant-Id': TENANT,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  console.log('→ logging in');
  token = await login();

  const fleet = JSON.parse((await import('node:fs')).readFileSync('/tmp/fleet-seed.json', 'utf8'));

  console.log(`→ registering ${fleet.length} video channels`);
  let created = 0;
  let skipped = 0;
  for (const v of fleet) {
    const existing = await api('GET', `/channels?vehicleId=${v.vehicleId}`);
    if ((existing ?? []).length > 0) {
      skipped++;
      continue;
    }
    await api('POST', '/channels', {
      vehicleId: v.vehicleId,
      deviceId: v.deviceId,
      label: `${v.vehicleName} - دوربین جلو`,
      logicalChannel: 1,
      protocol: 'MEITRACK_MDVR',
      codec: 'H264',
      endpoint: v.imei,
    });
    created++;
    if ((created + skipped) % 20 === 0) console.log(`  ${created + skipped}/${fleet.length}`);
  }
  console.log(`✓ channels: ${created} created, ${skipped} already existed`);
}

main().catch((err) => {
  console.error('SEED FAILED:', err.message);
  process.exit(1);
});
