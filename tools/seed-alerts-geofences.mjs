#!/usr/bin/env node
/**
 * Seed geofences + alert rules (via REST) and one month of historical
 * alerts / notifications / fleet events (via CSV → COPY).
 *
 * Usage: node tools/seed-alerts-geofences.mjs
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const TENANT = 'c6213758-9f71-460e-a66e-1da2ba6b25b4';
const ADMIN_USER = '1f6eb2d1-0b41-4903-b6fe-a354b9ecd6e4';
const fleet = JSON.parse((await import('node:fs')).readFileSync('/tmp/fleet-seed.json', 'utf8'));

async function login() {
  const res = await fetch('http://localhost:3000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': TENANT },
    body: JSON.stringify({ email: 'admin@fleetvision.local', password: 'ChangeMe!StrongPass123' }),
  });
  const { data } = await res.json();
  return data.access_token;
}
const token = await login();

async function api(base, method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Tenant-Id': TENANT,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${base}${path} → ${res.status}: ${text.slice(0, 250)}`);
  return text ? JSON.parse(text) : null;
}

function circlePolygon(lat, lng, radiusM, points = 16) {
  const coords = [];
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * 2 * Math.PI;
    const dLat = (radiusM / 111_320) * Math.sin(a);
    const dLng = (radiusM / (111_320 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a);
    coords.push([+(lng + dLng).toFixed(6), +(lat + dLat).toFixed(6)]);
  }
  return { type: 'Polygon', coordinates: [coords] };
}

// ── geofences (map-engine :3009) ─────────────────────────────────────────────
const GEOFENCES = [
  {
    name: 'دیپو ناوگان توزیع تهران',
    lat: 35.652,
    lng: 51.405,
    r: 400,
    desc: 'پارکینگ اصلی ناوگان توزیع',
  },
  { name: 'دیپو بار کرج', lat: 35.838, lng: 51.005, r: 600, desc: 'دهکده بار کرج' },
  { name: 'دیپو خدمات شمال', lat: 35.77, lng: 51.46, r: 300, desc: 'انبار خدمات' },
  { name: 'پارکینگ مسافربری شرق', lat: 35.73, lng: 51.53, r: 350, desc: 'سرویس پرسنل' },
  { name: 'سردخانه جنوب', lat: 35.63, lng: 51.48, r: 300, desc: 'ناوگان یخچال‌دار' },
  { name: 'محدوده بازار بزرگ', lat: 35.6734, lng: 51.42, r: 500, desc: 'ناحیه تحویل بار بازار' },
  {
    name: 'محدوده فرودگاه امام خمینی',
    lat: 35.4155,
    lng: 51.1522,
    r: 1500,
    desc: 'ورود/خروج خودروها به فرودگاه',
  },
];
console.log('→ geofences');
const geofenceIds = [];
for (const g of GEOFENCES) {
  const existing = await api('http://localhost:3009', 'GET', '/geofences?limit=100');
  const found = (existing.data ?? existing.items ?? []).find?.((x) => x.name === g.name);
  if (found) {
    geofenceIds.push(found.id);
    continue;
  }
  const created = await api('http://localhost:3009', 'POST', '/geofences', {
    name: g.name,
    type: 'CIRCLE',
    boundary: circlePolygon(g.lat, g.lng, g.r),
    description: g.desc,
    centerLat: g.lat,
    centerLng: g.lng,
    radiusM: g.r,
    alertOn: ['ENTER', 'EXIT'],
  });
  geofenceIds.push(created.data?.id ?? created.id);
}
console.log(`  ${geofenceIds.length} geofences ready`);

// ── alert rules (notification :3008) ─────────────────────────────────────────
console.log('→ alert rules');
const RULES = [
  {
    name: 'سرعت غیرمجاز بالای ۹۰',
    type: 'overspeed',
    severity: 'HIGH',
    conditions: { thresholdKmh: 90 },
    cooldown_sec: 600,
  },
  {
    name: 'سرعت غیرمجاز بالای ۷۵',
    type: 'overspeed',
    severity: 'MEDIUM',
    conditions: { thresholdKmh: 75 },
    cooldown_sec: 900,
  },
  {
    name: 'کارکرد درجا طولانی',
    type: 'prolonged_idle',
    severity: 'LOW',
    conditions: { minDurationSec: 600 },
    cooldown_sec: 1800,
  },
  {
    name: 'خروج از محدوده مجاز',
    type: 'geofence_exit',
    severity: 'MEDIUM',
    conditions: {},
    cooldown_sec: 600,
  },
  {
    name: 'قطع اتصال دستگاه',
    type: 'device_offline',
    severity: 'HIGH',
    conditions: { minOfflineSec: 1800 },
    cooldown_sec: 3600,
  },
  {
    name: 'سفر بیش از حد طولانی',
    type: 'excessive_trip_duration',
    severity: 'MEDIUM',
    conditions: { maxDurationSec: 14400 },
    cooldown_sec: 3600,
  },
];
const ruleIds = {};
const existingRules = await api(
  'http://localhost:3008',
  'GET',
  '/api/v1/notification/rules?limit=100',
);
for (const r of RULES) {
  const found = (existingRules.data ?? []).find((x) => x.name === r.name);
  if (found) {
    ruleIds[r.name] = found.id;
    continue;
  }
  const created = await api('http://localhost:3008', 'POST', '/api/v1/notification/rules', r);
  ruleIds[r.name] = created.data?.id ?? created.id;
}
console.log(`  ${Object.keys(ruleIds).length} rules ready`);

// ── historical alerts / notifications / fleet events ─────────────────────────
console.log('→ historical alerts');
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
const rnd = mulberry32(555000);
const rr = (a, b) => a + rnd() * (b - a);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const T0 = Date.now();
const day = 86_400_000;

// vehicleId → sample location from history (use depot-ish coords around Tehran).
const alerts = [];
const notifications = [];
const events = [];
const alertTypes = [
  { rule: 'سرعت غیرمجاز بالای ۹۰', type: 'overspeed', sev: 'HIGH', w: 40 },
  { rule: 'سرعت غیرمجاز بالای ۷۵', type: 'overspeed', sev: 'MEDIUM', w: 30 },
  { rule: 'کارکرد درجا طولانی', type: 'prolonged_idle', sev: 'LOW', w: 12 },
  { rule: 'خروج از محدوده مجاز', type: 'geofence_exit', sev: 'MEDIUM', w: 10 },
  { rule: 'قطع اتصال دستگاه', type: 'device_offline', sev: 'HIGH', w: 6 },
  { rule: 'سفر بیش از حد طولانی', type: 'excessive_trip_duration', sev: 'MEDIUM', w: 4 },
];
const weighted = () => {
  const total = alertTypes.reduce((s, t) => s + t.w, 0);
  let r = rnd() * total;
  for (const t of alertTypes) {
    r -= t.w;
    if (r <= 0) return t;
  }
  return alertTypes[0];
};
const FA_MSG = {
  overspeed: (s) => `سرعت غیرمجاز: ${Math.round(s)} کیلومتر بر ساعت`,
  prolonged_idle: (m) => `کارکرد درجا طولانی: ${Math.round(m)} دقیقه`,
  geofence_exit: () => 'خروج خودرو از محدوده جغرافیایی تعریف‌شده',
  device_offline: (h) => `قطع ارتباط دستگاه ردیاب بیش از ${Math.round(h)} ساعت`,
  excessive_trip_duration: (h) => `مدت سفر غیرعادی: ${Math.round(h)} ساعت`,
};
let alertCount = 0;
for (let i = 0; i < 430; i++) {
  const v = pick(fleet);
  const at = weighted();
  const raisedMs = T0 - rnd() * 30 * day;
  const ageDays = (T0 - raisedMs) / day;
  const lat = 35.6 + rnd() * 0.25;
  const lng = 51.15 + rnd() * 0.45;
  let msg;
  let detail;
  if (at.type === 'overspeed') {
    const s = at.sev === 'HIGH' ? rr(91, 118) : rr(76, 90);
    msg = FA_MSG.overspeed(s);
    detail = { speedKmh: +s.toFixed(1), thresholdKmh: at.sev === 'HIGH' ? 90 : 75 };
  } else if (at.type === 'prolonged_idle') {
    const m = rr(10, 35);
    msg = FA_MSG.prolonged_idle(m);
    detail = { durationSec: Math.round(m * 60) };
  } else if (at.type === 'geofence_exit') {
    msg = FA_MSG.geofence_exit();
    detail = { geofenceId: pick(geofenceIds) };
  } else if (at.type === 'device_offline') {
    const h = rr(1, 26);
    msg = FA_MSG.device_offline(h);
    detail = { offlineSec: Math.round(h * 3600) };
  } else {
    const h = rr(4, 9);
    msg = FA_MSG.excessive_trip_duration(h);
    detail = { durationSec: Math.round(h * 3600) };
  }
  // Status mix: older mostly resolved, recent open/acknowledged.
  let status = 'OPEN';
  let ackAt = '';
  let ackBy = '';
  let resAt = '';
  let resBy = '';
  let reason = '';
  const p = rnd();
  if (ageDays > 2 && p < 0.75) {
    status = 'RESOLVED';
    resAt = new Date(raisedMs + rr(0.2, 20) * 3600_000).toISOString();
    resBy = ADMIN_USER;
    reason = 'بررسی و تایید توسط اپراتور';
    if (rnd() < 0.7) {
      ackAt = new Date(raisedMs + rr(0.05, 4) * 3600_000).toISOString();
      ackBy = ADMIN_USER;
      status = 'ACKNOWLEDGED';
    }
  } else if (p < 0.35) {
    status = 'ACKNOWLEDGED';
    ackAt = new Date(raisedMs + rr(0.05, 2) * 3600_000).toISOString();
    ackBy = ADMIN_USER;
  }
  const id = randomUUID();
  alerts.push([
    id,
    TENANT,
    ruleIds[at.rule],
    at.type.toUpperCase(),
    at.sev,
    status,
    v.vehicleId,
    lat.toFixed(6),
    lng.toFixed(6),
    msg,
    JSON.stringify(detail),
    '[]',
    new Date(raisedMs).toISOString(),
    ackAt,
    ackBy,
    resAt,
    resBy,
    reason,
  ]);
  alertCount++;
  // Notification for HIGH/CRITICAL recent alerts.
  if (at.sev === 'HIGH' && ageDays < 7 && rnd() < 0.6) {
    notifications.push([
      randomUUID(),
      TENANT,
      ADMIN_USER,
      'alarm',
      at.sev.toLowerCase(),
      `هشدار ${at.type === 'overspeed' ? 'سرعت' : 'سیستمی'} — ${v.plate}`,
      msg,
      `/alarms?alert=${id}`,
      rnd() < 0.4 ? 't' : 'f',
      '',
      'alert',
      id,
      new Date(raisedMs + 5000).toISOString(),
      'alarm.raised',
      v.vehicleId,
      JSON.stringify({ alertId: id, severity: at.sev }),
      at.sev === 'HIGH' ? 'high' : 'normal',
    ]);
  }
}
// A couple of SOS criticals (resolved).
for (let i = 0; i < 3; i++) {
  const v = pick(fleet);
  const raisedMs = T0 - rr(4, 25) * day;
  const id = randomUUID();
  alerts.push([
    id,
    TENANT,
    ruleIds['سرعت غیرمجاز بالای ۹۰'],
    'SOS',
    'CRITICAL',
    'RESOLVED',
    v.vehicleId,
    (35.6 + rnd() * 0.25).toFixed(6),
    (51.15 + rnd() * 0.45).toFixed(6),
    'دکمه اضطراری (SOS) توسط راننده فشرده شد',
    '{"source":"device"}',
    '[]',
    new Date(raisedMs).toISOString(),
    new Date(raisedMs + 300_000).toISOString(),
    ADMIN_USER,
    new Date(raisedMs + 5400_000).toISOString(),
    ADMIN_USER,
    'تماس با راننده — موارد کاذب',
  ]);
  notifications.push([
    randomUUID(),
    TENANT,
    ADMIN_USER,
    'alarm',
    'critical',
    `هشدار اضطراری SOS — ${v.plate}`,
    'دکمه اضطراری توسط راننده فشرده شد',
    `/alarms?alert=${id}`,
    't',
    '',
    'alert',
    id,
    new Date(raisedMs + 5000).toISOString(),
    'alarm.raised',
    v.vehicleId,
    JSON.stringify({ alertId: id }),
    'urgent',
  ]);
}

// Fleet events (event-stream page): mix over the last 30 days.
const EVENT_KINDS = [
  { et: 'device.offline', sev: 'WARNING' },
  { et: 'device.online', sev: 'INFO' },
  { et: 'geofence.entered', sev: 'INFO' },
  { et: 'geofence.exited', sev: 'WARNING' },
  { et: 'trip.started', sev: 'INFO' },
  { et: 'trip.ended', sev: 'INFO' },
  { et: 'alarm.raised', sev: 'WARNING' },
];
for (let i = 0; i < 60; i++) {
  const v = pick(fleet);
  const k = pick(EVENT_KINDS);
  const atMs = T0 - rnd() * 30 * day;
  events.push([
    `evt-${randomUUID()}`,
    TENANT,
    v.vehicleId,
    v.deviceId,
    k.et,
    new Date(atMs).toISOString(),
    new Date(atMs + 3000).toISOString(),
    k.sev,
    JSON.stringify({ vehiclePlate: v.plate, fleetCode: v.fleetCode }),
  ]);
}

const q = (s) => {
  if (typeof s !== 'string') return s;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};
const csv = (rows) => rows.map((r) => r.map(q).join(',')).join('\n');
writeFileSync('/tmp/csv/alerts.csv', csv(alerts));
writeFileSync('/tmp/csv/notifications.csv', csv(notifications));
writeFileSync('/tmp/csv/fleet_events.csv', csv(events));
writeFileSync('/tmp/rule-ids.json', JSON.stringify(ruleIds));
console.log(
  `✓ ${alertCount + 3} alerts, ${notifications.length} notifications, ${events.length} fleet events → /tmp/csv/*.csv`,
);
