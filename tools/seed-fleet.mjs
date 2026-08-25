#!/usr/bin/env node
/**
 * Seed a realistic 100-vehicle fleet through the public REST APIs.
 *
 * Creates: 5 fleets → N devices (Luhn-valid IMEIs, meitrack) → N vehicles
 * (Persian names, Iranian plates) → 1:1 vehicle↔device bindings.
 *
 * Usage: SEED_COUNT=10 SEED_TENANT_ID=<uuid> node tools/seed-fleet.mjs
 */
const API = process.env.SEED_API_BASE ?? 'http://localhost:3006/api/v1';
const IDENTITY = process.env.SEED_IDENTITY_BASE ?? 'http://localhost:3000/api/v1';
const TENANT = process.env.SEED_TENANT_ID ?? 'c6213758-9f71-460e-a66e-1da2ba6b25b4';
const EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@fleetvision.local';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!StrongPass123';
const COUNT = Math.max(1, Number(process.env.SEED_COUNT ?? 100) || 100);

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

/** Luhn-checksum-valid 15-digit IMEI from a 14-digit TAC+SN base. */
function luhnImei(base14) {
  // Double every second digit from the right of the full 15-digit number
  // (i.e. array indices 13, 11, 9, … of the 14-digit base).
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(base14[i]);
    if ((13 - i) % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  const check = (10 - (sum % 10)) % 10;
  return base14 + String(check);
}

const FLEETS = [
  { name: 'ناوگان توزیع تهران', code: 'THD', description: 'توزیع کالا درون‌شهری تهران' },
  { name: 'ناوگان حمل بار کرج', code: 'KRF', description: 'حمل بار مسیر کرج–تهران' },
  { name: 'ناوگان خدمات و پشتیبانی', code: 'SRV', description: 'خودروهای خدماتی و فنی' },
  { name: 'ناوگان مسافربری سازمانی', code: 'PAX', description: 'سرویس و مسافربری پرسنل' },
  { name: 'ناوگان یخچال‌دار', code: 'RFR', description: 'حمل محصولات نیازمند سرد کردن' },
];

// Vehicle types with realistic Iranian fleet mixes + models.
const VEHICLE_TYPES = [
  { type: 'وانت نیسان', models: ['Zamyad Zamad 24', 'Nissan Junior'], weight: 26 },
  { type: 'خاور', models: ['Khavar 808', 'Khavar 2624'], weight: 18 },
  { type: 'بنز آکتروس', models: ['Actros 1845', 'Actros 2545'], weight: 12 },
  { type: 'ایسوزو NPR', models: ['Isuzu NPR 75', 'Isuzu NQR'], weight: 12 },
  { type: 'ولوو FH', models: ['Volvo FH440', 'Volvo FM'], weight: 8 },
  { type: 'مینی‌بوس ایسوزو', models: ['Isuzu Journey', 'Isuzu Novo'], weight: 6 },
  { type: 'کامیونت فوتون', models: ['Foton Aumark', 'Foton ETX'], weight: 8 },
  { type: 'سواری سازمانی پژو ۲۰۶', models: ['Peugeot 206 SD'], weight: 10 },
];

// Iranian plate: 2 digits + Persian letter + 3 digits + 2 digits (issue code).
const PLATE_LETTERS = [
  'ب',
  'ج',
  'د',
  'س',
  'ص',
  'ط',
  'ق',
  'ل',
  'م',
  'ن',
  'و',
  'ه',
  'ی',
  'پ',
  'ت',
  'ث',
  'ز',
  'ش',
  'ع',
  'ف',
  'ک',
  'گ',
];
const DEVICE_MODELS = [
  { manufacturer: 'Meitrack', model: 'MVT380' },
  { manufacturer: 'Meitrack', model: 'MVT600' },
  { manufacturer: 'Meitrack', model: 'T622', weight: 2 },
  { manufacturer: 'Meitrack', model: 'MT90L' },
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260823);

function pick(arr, r = rnd()) {
  return arr[Math.floor(r * arr.length) % arr.length];
}

function weightedPick(items) {
  const total = items.reduce((s, i) => s + (i.weight ?? 1), 0);
  let r = rnd() * total;
  for (const it of items) {
    r -= it.weight ?? 1;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

const PAD2 = (n) => String(n).padStart(2, '0');

async function main() {
  console.log('→ logging in');
  token = await login();

  console.log('→ creating fleets');
  const fleets = [];
  for (const f of FLEETS) {
    const existing = await api('GET', `/fleets?search=${encodeURIComponent(f.code)}&limit=5`);
    const found = (existing.data ?? []).find((x) => x.code === f.code);
    if (found) {
      fleets.push(found);
      console.log(`  fleet ${f.code} exists`);
    } else {
      const created = await api('POST', '/fleets', f);
      fleets.push(created.data);
      console.log(`  fleet ${f.code} created`);
    }
  }

  // Expand vehicle types into a per-vehicle plan (spread across fleets).
  const perFleet = Math.max(1, Math.ceil(COUNT / fleets.length));
  const plan = [];
  for (let i = 0; i < COUNT; i++) {
    const vt = weightedPick(VEHICLE_TYPES);
    const fleet = fleets[Math.min(Math.floor(i / perFleet), fleets.length - 1)];
    plan.push({ idx: i, vt, fleet });
  }

  console.log(`→ creating ${COUNT} devices`);
  const devices = [];
  const usedImeis = new Set();
  for (const p of plan) {
    let imei;
    do {
      // Realistic TAC prefixes: 865237 (Quectel), 867191 (SIMCom), 868904, 864895.
      const tac = pick(['865237', '867191', '868904', '864895']);
      imei = luhnImei(tac + String(Math.floor(rnd() * 1e8)).padStart(8, '0'));
    } while (usedImeis.has(imei));
    usedImeis.add(imei);
    const dm = weightedPick(DEVICE_MODELS);
    const serial = `SN-${String(240000 + p.idx * 7)}`;
    // Idempotent: a deterministic IMEI may already exist from a partial run.
    const found = await api('GET', `/devices?imei=${imei}&limit=1`);
    if (found.data?.length > 0) {
      devices.push(found.data[0]);
      continue;
    }
    const created = await api('POST', '/devices', {
      imei,
      protocol: 'meitrack',
      serialNumber: serial,
      manufacturer: dm.manufacturer,
      model: dm.model,
    });
    devices.push(created.data);
    if ((p.idx + 1) % 10 === 0 || p.idx + 1 === COUNT) {
      console.log(`  ${p.idx + 1}/${COUNT} devices`);
    }
  }

  console.log(`→ creating ${COUNT} vehicles`);
  const vehicles = [];
  const usedPlates = new Set();
  const usedCodes = new Set();
  for (const p of plan) {
    let plate;
    do {
      const city = pick(['22', '22', '22', '53', '36', '66', '77']);
      plate = `${city}${pick(PLATE_LETTERS)}${String(Math.floor(rnd() * 900) + 100)}${city === '22' ? pick(['22', '47', '11']) : city}${PAD2(Math.floor(rnd() * 90) + 10)}`;
    } while (usedPlates.has(plate));
    usedPlates.add(plate);
    let code;
    do {
      code = `${p.fleet.code}-${String(p.idx + 1).padStart(3, '0')}`;
    } while (usedCodes.has(code));
    usedCodes.add(code);
    const model = pick(p.vt.models);
    // Idempotent: deterministic codes survive partial runs.
    const found = await api('GET', `/vehicles?search=${encodeURIComponent(code)}&limit=5`);
    const existing = (found.data ?? []).find((v) => v.code === code);
    if (existing) {
      vehicles.push(existing);
      continue;
    }
    // VIN: letters+digits only, no I/O/Q, exactly ≤17 chars.
    const vin =
      `VF${String(10000 + p.idx * 731)}${String(Math.floor(rnd() * 90000) + 10000)}X${String(p.idx).padStart(2, '0')}`.slice(
        0,
        17,
      );
    const created = await api('POST', '/vehicles', {
      fleetId: p.fleet.id,
      name: `${p.vt.type} ${model.split(' ')[0]} ${plate.slice(0, 2)}`,
      code,
      plate,
      vin,
    });
    vehicles.push(created.data);
    if ((p.idx + 1) % 10 === 0 || p.idx + 1 === COUNT) {
      console.log(`  ${p.idx + 1}/${COUNT} vehicles`);
    }
  }

  console.log(`→ binding devices to vehicles (1:1, TRACKER, primary)`);
  for (let i = 0; i < COUNT; i++) {
    // Already-bound from a partial run → list returns the binding; skip.
    const bound = await api('GET', `/vehicles/${vehicles[i].id}/devices`);
    if ((bound.data ?? []).some((d) => d.deviceId === devices[i].id || d.id === devices[i].id)) {
      continue;
    }
    await api('POST', `/vehicles/${vehicles[i].id}/devices/${devices[i].id}`, {
      role: 'TRACKER',
      isPrimary: true,
    });
    if ((i + 1) % 10 === 0 || i + 1 === COUNT) console.log(`  ${i + 1}/${COUNT} bound`);
  }

  const summary = await api('GET', '/summary');
  console.log('✓ summary:', JSON.stringify(summary.data));

  // Persist the mapping for the history generator + live simulator.
  const { writeFileSync } = await import('node:fs');
  const out = plan.map((p, i) => ({
    idx: p.idx,
    fleetCode: p.fleet.code,
    fleetId: p.fleet.id,
    fleetName: p.fleet.name,
    vehicleId: vehicles[i].id,
    vehicleName: vehicles[i].name,
    plate: vehicles[i].plate,
    vehicleType: p.vt.type,
    deviceId: devices[i].id,
    imei: devices[i].imei,
    deviceModel: devices[i].model,
  }));
  writeFileSync('/tmp/fleet-seed.json', JSON.stringify(out, null, 1));
  console.log('✓ mapping written to /tmp/fleet-seed.json');
}

main().catch((err) => {
  console.error('SEED FAILED:', err.message);
  process.exit(1);
});
