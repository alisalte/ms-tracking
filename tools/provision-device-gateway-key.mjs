#!/usr/bin/env node
/**
 * Provision the device-gateway's service API key (one-off, per deployment).
 *
 * The gateway resolves IMEI → device identity via fleet-management's
 * `GET /api/v1/devices/resolve` — a SERVICE-ONLY route that requires an
 * `fv_…` API key carrying the `device.registry.resolve` scope. User roles
 * deliberately never hold that permission, so the key must be minted once by
 * the seeded admin and set as `FLEET_REGISTRY_API_KEY` in infra/docker/.env.
 *
 * Usage:
 *   node tools/provision-device-gateway-key.mjs \
 *     [--base-url http://localhost:8080] \
 *     [--tenant FleetVision] \
 *     [--email admin@fleetvision.local] [--password '…']
 *
 * Environment overrides: FV_BASE_URL / FV_TENANT / FV_ADMIN_EMAIL /
 * FV_ADMIN_PASSWORD (fall back to the compose SEED_* defaults).
 *
 * Prints the .env line to append; the plaintext key is shown ONCE (it is not
 * retrievable afterwards — only its prefix is stored).
 */
const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i !== -1 && args[i + 1]) return args[i + 1];
  return fallback;
}

const baseUrl = arg('base-url', process.env.FV_BASE_URL ?? 'http://localhost:8080').replace(
  /\/$/,
  '',
);
const tenant = arg('tenant', process.env.FV_TENANT ?? 'FleetVision');
const email = arg('email', process.env.FV_ADMIN_EMAIL ?? 'admin@fleetvision.local');
const password = arg('password', process.env.FV_ADMIN_PASSWORD ?? 'ChangeMe!StrongPass123');

async function main() {
  // 1. Login as the seeded admin (X-Tenant-Id accepts the tenant NAME).
  const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenant },
    body: JSON.stringify({ email, password }),
  });
  if (!loginRes.ok) {
    throw new Error(`login failed: ${loginRes.status} ${await loginRes.text()}`);
  }
  const login = (await loginRes.json()).data ?? (await loginRes.json());
  const token = login.access_token ?? login.accessToken;
  if (!token) throw new Error('no access_token in login response');
  // The api-keys guard requires the canonical tenant UUID — decode it from the
  // JWT payload (the login response body does not carry a tenant object).
  const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64').toString('utf8'));
  const tenantId = payload.tenant_id;

  // 2. Mint the service key scoped to registry resolution.
  const keyRes = await fetch(`${baseUrl}/api/v1/auth/api-keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Tenant-Id': tenantId,
    },
    body: JSON.stringify({
      name: `device-gateway-${new Date().toISOString().slice(0, 10)}`,
      scopes: ['device.registry.resolve'],
    }),
  });
  if (!keyRes.ok) {
    throw new Error(`api-key create failed: ${keyRes.status} ${await keyRes.text()}`);
  }
  const created = (await keyRes.json()).data;
  if (!created?.key?.startsWith('fv_'))
    throw new Error(`unexpected key shape: ${created?.key_prefix}`);

  console.log('Service API key created (shown once):');
  console.log('');
  console.log(`FLEET_REGISTRY_API_KEY=${created.key}`);
  console.log('');
  console.log('Append the line above to infra/docker/.env, then:');
  console.log('  docker compose -f infra/docker/docker-compose.yml up -d device-gateway-service');
}

main().catch((err) => {
  console.error(`[provision-device-gateway-key] ${err.message}`);
  process.exit(1);
});
