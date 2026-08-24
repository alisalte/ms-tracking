#!/usr/bin/env node
/**
 * Live fleet simulator — 100 meitrack devices streaming through the REAL
 * gateway (TCP :5023) → Kafka → gps-engine → Postgres/Redis/WebSocket.
 *
 * Continues each vehicle from its last historical position (/tmp/live-state.json,
 * written by generate-history.mjs). Devices marked offline there never connect.
 *
 * Per-device state machine: PARKED (heartbeats, ignition off) ⇄ DRIVING
 * (30s AAA tracking toward a POI, dwell, return to depot). Aggressive drivers
 * occasionally exceed 90 km/h → emit meitrack event 19 (OVERSPEED). Very rare
 * SOS (event 1). All frames are spec-exact: $$A<len>,<imei>,AAA,...*<CS>\r\n.
 *
 * Usage: node tools/fleet-live-simulator.mjs [--host 127.0.0.1] [--port 5023]
 */
import { readFileSync } from 'node:fs';
import net from 'node:net';

const HOST = process.argv.includes('--host')
  ? process.argv[process.argv.indexOf('--host') + 1]
  : (process.env.LIVE_SIM_HOST ?? '127.0.0.1');
const PORT = process.argv.includes('--port')
  ? Number(process.argv[process.argv.indexOf('--port') + 1])
  : Number(process.env.LIVE_SIM_PORT ?? 5023);

const state = JSON.parse(readFileSync('/tmp/live-state.json', 'utf8'));

const POIS = [
  { lat: 35.6734, lng: 51.42, hwy: false },
  { lat: 35.615, lng: 51.59, hwy: true },
  { lat: 35.746, lng: 51.51, hwy: false },
  { lat: 35.699, lng: 51.339, hwy: false },
  { lat: 35.8, lng: 51.434, hwy: false },
  { lat: 35.738, lng: 51.56, hwy: false },
  { lat: 35.61, lng: 51.44, hwy: false },
  { lat: 35.762, lng: 51.336, hwy: false },
  { lat: 35.77, lng: 51.41, hwy: false },
  { lat: 35.64, lng: 51.49, hwy: false },
  { lat: 35.76, lng: 51.367, hwy: false },
  { lat: 35.785, lng: 51.47, hwy: false },
  { lat: 35.843, lng: 50.99, hwy: true },
  { lat: 35.4155, lng: 51.1522, hwy: true },
  { lat: 35.7465, lng: 51.5545, hwy: true },
  { lat: 35.7415, lng: 51.497, hwy: false },
];
const DEPOTS = {
  THD: [35.652, 51.405],
  KRF: [35.838, 51.005],
  SRV: [35.77, 51.46],
  PAX: [35.73, 51.53],
  RFR: [35.63, 51.48],
};

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;
function destination(lat, lng, bearingDeg, distM) {
  const d = distM / 6371000;
  const br = toRad(bearingDeg);
  const la1 = toRad(lat);
  const lo1 = toRad(lng);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br));
  const lo2 =
    lo1 +
    Math.atan2(
      Math.sin(br) * Math.sin(d) * Math.cos(la1),
      Math.cos(d) - Math.sin(la1) * Math.sin(la2),
    );
  return [toDeg(la2), toDeg(lo2)];
}
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
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

/** Build a spec-exact meitrack tracking frame. */
function meitrackFrame({
  imei,
  event = 0,
  lat,
  lng,
  speedKmh,
  headingDeg,
  ignition,
  odoKm,
  runtimeS,
}) {
  const now = new Date();
  const ts = [
    String(now.getUTCFullYear() % 100).padStart(2, '0'),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('');
  const body = [
    imei,
    'AAA',
    String(event),
    lat.toFixed(6),
    lng.toFixed(6),
    ts,
    'A',
    String(8 + Math.floor(Math.random() * 7)),
    String(12 + Math.floor(Math.random() * 18)),
    speedKmh.toFixed(1),
    headingDeg.toFixed(1),
    (0.7 + Math.random() * 1.2).toFixed(1),
    '1185',
    String(Math.round(odoKm * 1000)),
    String(runtimeS),
    `432|${Math.random() < 0.5 ? '35' : '11'}|${10000 + Math.floor(Math.random() * 89999)}|${100000 + Math.floor(Math.random() * 899999)}`,
    ignition ? '01' : '00',
    '00',
    `4.${1 + Math.floor(Math.random() * 3)}|13.${2 + Math.floor(Math.random() * 6)}`,
  ].join(',');
  const len = body.length + 6; // comma + body + * + cs(2) + \r\n
  const prefix = `$$A${String(len).padStart(4, '0')}`;
  const region = `${prefix},${body}*`;
  let sum = 0;
  for (const ch of Buffer.from(region, 'ascii')) sum = (sum + ch) & 0xff;
  return Buffer.from(`${region}${sum.toString(16).toUpperCase().padStart(2, '0')}\r\n`, 'ascii');
}

// ── device model ─────────────────────────────────────────────────────────────
const stats = { sent: 0, alarms: 0, reconnects: 0 };
class SimDevice {
  constructor(v) {
    this.v = v;
    this.imei = v.imei;
    this.lat = v.lat;
    this.lng = v.lng;
    this.odoKm = v.odoKm;
    this.runtimeS = 3600 * 24 * (30 + Math.random() * 300);
    this.aggressive = v.aggressive;
    this.depot = DEPOTS[v.fleetCode] ?? DEPOTS.THD;
    // ~55% start driving within the first minutes; rest parked at depot.
    this.mode = Math.random() < 0.55 ? 'DRIVING' : 'PARKED';
    this.target = null;
    this.legFrom = null;
    if (this.mode === 'DRIVING') this.startTrip();
    this.heading = Math.random() * 360;
    this.speed = 0;
    this.ignition = this.mode === 'DRIVING';
    this.nextEventAt = Date.now() + Math.random() * 20_000;
    this.lastOverspeedAt = 0;
    this.sock = null;
    this.stopped = false;
  }

  startTrip() {
    const poi = POIS[Math.floor(Math.random() * POIS.length)];
    this.target = {
      lat: poi.lat + (Math.random() - 0.5) * 0.002,
      lng: poi.lng + (Math.random() - 0.5) * 0.002,
      hwy: poi.hwy,
    };
    this.legFrom = { lat: this.lat, lng: this.lng };
    this.mode = 'DRIVING';
    this.ignition = true;
    this.returning = false;
  }

  tickDriving(now) {
    const dist = haversine(this.lat, this.lng, this.target.lat, this.target.lng);
    const far = dist > 8000 && this.target.hwy;
    let speed = far
      ? Math.min(115, Math.max(50, 85 + (Math.random() - 0.5) * 28))
      : Math.min(78, Math.max(12, 42 + (Math.random() - 0.5) * 28));
    if (this.aggressive) speed *= 1.22;
    if (dist < 400) speed = Math.min(speed, 25);
    this.speed = Math.round(speed * 10) / 10;
    const brg = bearing(this.lat, this.lng, this.target.lat, this.target.lng);
    this.heading = brg;
    const stepM = this.speed * (30 / 3.6);
    this.odoKm += stepM / 1000;
    this.runtimeS += 30;
    const [nLat, nLng] = destination(this.lat, this.lng, brg, Math.min(stepM, dist));
    this.lat = nLat + (Math.random() - 0.5) * 0.00006;
    this.lng = nLng + (Math.random() - 0.5) * 0.00006;
    if (dist < 120) {
      this.speed = 0;
      if (this.returning) {
        this.mode = 'PARKED';
        this.ignition = false;
        this.parkedUntil = now + (120 + Math.random() * 480) * 1000;
      } else {
        // dwell at customer, then return to depot
        this.mode = 'DWELL';
        this.ignition = false;
        this.dwellUntil = now + (5 * 60 + Math.random() * 15 * 60) * 1000;
      }
    }
    // Overspeed alarm packet (rate-limited to 1/10min per device).
    if (this.speed > 90 && now - this.lastOverspeedAt > 600_000) {
      this.lastOverspeedAt = now;
      this.send(19, now);
      stats.alarms++;
    }
  }

  tick() {
    const now = Date.now();
    if (now < this.nextEventAt) return;
    if (this.mode === 'DRIVING') {
      this.tickDriving(now);
      this.nextEventAt = now + 30_000;
    } else if (this.mode === 'DWELL') {
      this.speed = 0;
      this.ignition = false;
      if (now >= this.dwellUntil) {
        this.target = {
          lat: this.depot[0] + (Math.random() - 0.5) * 0.002,
          lng: this.depot[1] + (Math.random() - 0.5) * 0.002,
          hwy: false,
        };
        this.legFrom = { lat: this.lat, lng: this.lng };
        this.returning = true;
        this.mode = 'DRIVING';
        this.ignition = true;
      }
      this.nextEventAt = now + 60_000;
    } else {
      // PARKED at depot: slow heartbeat; occasionally depart.
      this.speed = 0;
      this.ignition = false;
      if (now > (this.parkedUntil ?? 0) && Math.random() < 0.18) this.startTrip();
      this.nextEventAt = now + 60_000;
    }
    this.send(0, now);
  }

  send(event, _now) {
    if (!this.sock || this.sock.destroyed) return;
    const frame = meitrackFrame({
      imei: this.imei,
      event,
      lat: this.lat,
      lng: this.lng,
      speedKmh: this.speed,
      headingDeg: this.heading,
      ignition: this.ignition,
      odoKm: this.odoKm,
      runtimeS: Math.round(this.runtimeS),
    });
    try {
      this.sock.write(frame);
      stats.sent++;
    } catch {
      /* connection will trigger reconnect */
    }
  }

  connect() {
    if (this.stopped) return;
    this.sock = net.connect({ host: HOST, port: PORT }, () => {
      this.send(0, Date.now()); // implicit login via first tracking packet
    });
    this.sock.on('data', () => {
      /* drain server→device frames (acks/commands) */
    });
    this.sock.on('error', () => {});
    this.sock.on('close', () => {
      if (this.stopped) return;
      stats.reconnects++;
      setTimeout(() => this.connect(), 3000 + Math.random() * 5000);
    });
  }

  stop() {
    this.stopped = true;
    this.sock?.destroy();
  }
}

const devices = state.filter((v) => !v.offline).map((v) => new SimDevice(v));
console.log(
  `→ connecting ${devices.length} devices to ${HOST}:${PORT} (${state.length - devices.length} intentionally offline)`,
);

// Stagger connections over 20s so the gateway isn't thundering-herd hit.
devices.forEach((d, i) => setTimeout(() => d.connect(), (i * 200) % 20_000));

// Tick loop: each device self-schedules via nextEventAt (30s driving / 60s
// parked-dwell); poll every second so due ticks fire on time.
setInterval(() => {
  for (const d of devices) d.tick();
}, 1000);

setInterval(() => {
  const driving = devices.filter((d) => d.mode === 'DRIVING').length;
  const dwell = devices.filter((d) => d.mode === 'DWELL').length;
  const parked = devices.length - driving - dwell;
  console.log(
    `[sim] sent=${stats.sent} alarms=${stats.alarms} recon=${stats.reconnects} | driving=${driving} dwell=${dwell} parked=${parked}`,
  );
}, 30_000);

process.on('SIGINT', () => {
  console.log('\n→ stopping simulator');
  for (const d of devices) d.stop();
  setTimeout(() => process.exit(0), 500);
});
