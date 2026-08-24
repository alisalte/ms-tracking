#!/usr/bin/env node
/**
 * Generate ONE MONTH of realistic fleet telemetry for 100 vehicles.
 *
 * Produces (CSV → COPY into Postgres):
 *   - tracking.vehicle_positions  (~1.3M rows: 30s driving / 20min stop / 45min overnight)
 *   - tracking.trip_events        (ignition-on driving sessions, COMPLETED)
 *   - tracking.parking_periods    (≥10min stops, ENDED)
 *   - tracking.idle_periods       (ignition-on stationary ≥3min)
 *   - tracking.engine_hours       (hourly ignition-on rollups)
 *   - tracking.device_status      (all OFFLINE at T0; live simulator flips them ONLINE)
 *   - notification.alerts + rules (created via API first) + notifications + fleet_events
 *
 * Realism model:
 *   - 5 depots (one per fleet) + 18 Tehran-area customer POIs (incl. کرج/فرودگاه highway legs)
 *   - Iran work week: Sat–Wed full, Thu partial, Fri mostly off; a few night shifts
 *   - Speeds ~N(42,12) city / N(85,12) highway; aggressive drivers ×1.25
 *   - Traffic micro-stops, idle before departure, GPS jitter, odometer accumulation
 *
 * Usage: node tools/generate-history.mjs [--days 30]
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const TENANT = 'c6213758-9f71-460e-a66e-1da2ba6b25b4';
const DAYS = Number(
  process.argv.includes('--days') ? process.argv[process.argv.indexOf('--days') + 1] : 30,
);
const T0 = Date.now(); // history ends "now"
const OUT = '/tmp/csv';

// ── deterministic RNG ────────────────────────────────────────────────────────
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
const rnd = mulberry32(987654321);
const rr = (min, max) => min + rnd() * (max - min);
const ri = (min, max) => Math.floor(rr(min, max + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

// ── geo helpers ──────────────────────────────────────────────────────────────
const R_EARTH = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;
function destination(lat, lng, bearingDeg, distM) {
  const d = distM / R_EARTH;
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
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}

// ── world model ──────────────────────────────────────────────────────────────
const DEPOTS = {
  THD: { name: 'پارکینگ ناوگان توزیع جنوب تهران', lat: 35.652, lng: 51.405 },
  KRF: { name: 'دهکده بار کرج', lat: 35.838, lng: 51.005 },
  SRV: { name: 'الانگاه خدمات شمال', lat: 35.77, lng: 51.46 },
  PAX: { name: 'پارکینگ مسافربری شرق', lat: 35.73, lng: 51.53 },
  RFR: { name: 'سردخانه جنوب', lat: 35.63, lng: 51.48 },
};
const POIS = [
  { name: 'بازار بزرگ تهران', lat: 35.6734, lng: 51.42, hwy: false },
  { name: 'شهرک صنعتی شمس‌آباد', lat: 35.615, lng: 51.59, hwy: true },
  { name: 'نارمک', lat: 35.746, lng: 51.51, hwy: false },
  { name: 'میدان آزادی', lat: 35.699, lng: 51.339, hwy: false },
  { name: 'تجریش', lat: 35.8, lng: 51.434, hwy: false },
  { name: 'تهرانپارس', lat: 35.738, lng: 51.56, hwy: false },
  { name: 'شهر ری', lat: 35.61, lng: 51.44, hwy: false },
  { name: 'پونک', lat: 35.762, lng: 51.336, hwy: false },
  { name: 'خیابان جردن', lat: 35.77, lng: 51.41, hwy: false },
  { name: 'افسریه', lat: 35.64, lng: 51.49, hwy: false },
  { name: 'شهرک غرب', lat: 35.76, lng: 51.367, hwy: false },
  { name: 'خانی‌آباد نو', lat: 35.62, lng: 51.38, hwy: false },
  { name: 'فرمانیه', lat: 35.785, lng: 51.47, hwy: false },
  { name: 'نازی‌آباد', lat: 35.64, lng: 51.39, hwy: false },
  { name: 'میدان رسالت', lat: 35.7415, lng: 51.497, hwy: false },
  { name: 'ولنجک', lat: 35.805, lng: 51.405, hwy: false },
  { name: 'کرج - عظیمیه', lat: 35.843, lng: 50.99, hwy: true },
  { name: 'فرودگاه امام خمینی', lat: 35.4155, lng: 51.1522, hwy: true },
  { name: 'شهر جدید پردیس', lat: 35.7465, lng: 51.5545, hwy: true },
  { name: 'بازار قدس کرج', lat: 35.828, lng: 50.997, hwy: true },
];

// Local Tehran time helpers (UTC+3:30, no DST).
const TZ_OFFSET_MS = 3.5 * 3600_000;
const localMs = (utcMs) => new Date(utcMs + TZ_OFFSET_MS);
const dayStartLocalMs = (utcMs) => {
  const d = localMs(utcMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - TZ_OFFSET_MS;
};
const localDow = (utcMs) => localMs(utcMs).getUTCDay(); // 0=Sun … 5=Fri, 6=Sat

const iso = (ms) => new Date(ms).toISOString();

// ── CSV writers ──────────────────────────────────────────────────────────────
mkdirSync(OUT, { recursive: true });
const files = {
  positions: [],
  trips: [],
  parking: [],
  idle: [],
  engine: [],
  alerts: [],
  notifications: [],
  events: [],
  deviceStatus: [],
};
const uuid = () => randomUUID();

// ── per-vehicle simulation ───────────────────────────────────────────────────
const fleet = JSON.parse((await import('node:fs')).readFileSync('/tmp/fleet-seed.json', 'utf8'));

// Offline vehicles (device failure for the tail of the window): stop early.
const OFFLINE_EARLY = new Set(fleet.filter((_, i) => i % 19 === 7).map((v) => v.idx)); // ~5 vehicles
// Aggressive drivers (harsh events, overspeeds).
const AGGRESSIVE = new Set(fleet.filter((_, i) => i % 11 === 3).map((v) => v.idx)); // ~9 vehicles
// Night shift.
const NIGHT = new Set(fleet.filter((_, i) => i % 23 === 5).map((v) => v.idx)); // ~4 vehicles

const liveState = [];

for (const v of fleet) {
  const depot = DEPOTS[v.fleetCode];
  const aggressive = AGGRESSIVE.has(v.idx);
  const night = NIGHT.has(v.idx);
  let odoKm = rr(15_000, 280_000); // starting odometer
  let pos = { lat: depot.lat + rr(-0.001, 0.001), lng: depot.lng + rr(-0.001, 0.001) };
  const vehiclePositions = [];
  const veh = { rows: vehiclePositions, trips: [], parks: [], idles: [], engine: new Map() };

  // Preferred POIs per vehicle (2-5 regular customers).
  const regulars = Array.from({ length: ri(2, 5) }, () => pick(POIS));

  // Waypoints for a leg: 1-3 jittered intermediates so paths are not ruler-straight.
  function legWaypoints(from, to) {
    const n = ri(1, 3);
    const pts = [];
    const totalBrg = bearing(from.lat, from.lng, to.lat, to.lng);
    const totalDist = haversine(from.lat, from.lng, to.lat, to.lng);
    for (let i = 1; i <= n; i++) {
      const f = i / (n + 1);
      const along = totalDist * f;
      const [wLat, wLng] = destination(from.lat, from.lng, totalBrg, along);
      const side = rnd() < 0.5 ? 90 : -90;
      const [jLat, jLng] = destination(wLat, wLng, (totalBrg + side + 360) % 360, rr(80, 420));
      pts.push({ lat: jLat, lng: jLng });
    }
    pts.push({ lat: to.lat, lng: to.lng });
    return pts;
  }

  // Emit one position row.
  function emit(atMs, lat, lng, speedKmh, headDeg, ignition, sessionId, quality = 1) {
    const jitterLat = lat + rr(-0.00006, 0.00006);
    const jitterLng = lng + rr(-0.00006, 0.00006);
    vehiclePositions.push([
      uuid(),
      v.vehicleId,
      TENANT,
      iso(atMs),
      iso(atMs + ri(2, 8)),
      jitterLat.toFixed(6),
      jitterLng.toFixed(6),
      (1180 + rr(-60, 90)).toFixed(1),
      headDeg.toFixed(1),
      speedKmh.toFixed(1),
      (3 + rnd() * 5).toFixed(1),
      odoKm.toFixed(3),
      ignition ? 't' : 'f',
      v.deviceId,
      String(quality),
      sessionId,
      '{"protocol":"meitrack"}',
    ]);
  }

  // Drive one leg from→to; returns {endedAt, distanceKm, maxSpeed, stops, lastPos}.
  function driveLeg(from, to, atMs, sessionId) {
    const hwy = to.hwy === true && haversine(from.lat, from.lng, to.lat, to.lng) > 8000;
    const waypoints = legWaypoints(from, to);
    let cur = { ...from };
    let t = atMs;
    let dist = 0;
    let maxSpeed = 0;
    let stops = 0;
    for (const wp of waypoints) {
      const brg = bearing(cur.lat, cur.lng, wp.lat, wp.lng);
      const legDist = haversine(cur.lat, cur.lng, wp.lat, wp.lng);
      let done = 0;
      while (done < legDist) {
        // Speed sample: highway vs city; aggressive ×1.25; ramp near start/end.
        const base = hwy
          ? Math.min(115, Math.max(50, 85 + rr(-14, 14)))
          : Math.min(78, Math.max(12, 42 + rr(-14, 14)));
        let speed = base * (aggressive ? 1.25 : 1);
        if (done < 150 || legDist - done < 150) speed = Math.min(speed, rr(15, 30));
        speed = Math.min(speed, 118);
        const stepM = speed * (30 / 3.6);
        done += stepM;
        dist += stepM;
        odoKm += stepM / 1000;
        t += 30_000;
        const frac = Math.min(1, done / legDist);
        const [nLat, nLng] = destination(
          cur.lat,
          cur.lng,
          brg,
          stepM * Math.min(frac + (1 - frac) * 0.5, 1) * 0.98 + stepM * 0.5 * (1 - frac) * 0,
        );
        pos = { lat: nLat + rr(-0.00004, 0.00004), lng: nLng + rr(-0.00004, 0.00004) };
        emit(t, pos.lat, pos.lng, speed, brg + rr(-4, 4), true, sessionId);
        maxSpeed = Math.max(maxSpeed, speed);
        // Traffic micro-stop (city only): 1-3 stationary points.
        if (!hwy && rnd() < 0.05 && legDist - done > 300) {
          stops += 1;
          const stopS = ri(30, 120);
          for (let s = 0; s < stopS; s += 30) {
            t += 30_000;
            emit(t, pos.lat, pos.lng, 0, brg, true, sessionId);
          }
        }
      }
      cur = wp;
    }
    return { endedAt: t, distanceKm: dist / 1000, maxSpeed, stops, lastPos: pos };
  }

  // Ignition-on idle before departure.
  function idleBefore(atMs, sessionId) {
    const durS = ri(60, aggressive ? 480 : 300);
    const start = atMs;
    let t = atMs;
    for (let s = 0; s < durS; s += 30) {
      t += 30_000;
      emit(t, pos.lat, pos.lng, 0, ri(0, 359), true, sessionId);
    }
    if (durS >= 180) {
      veh.idles.push([
        uuid(),
        TENANT,
        v.vehicleId,
        iso(start),
        iso(t),
        String(durS),
        'f',
        iso(start),
      ]);
    }
    return t;
  }

  // Parked heartbeat points for durMs; parking period if ≥10min.
  function park(fromMs, durMs, sessionId) {
    let t = fromMs;
    const end = fromMs + durMs;
    const step = 45 * 60_000;
    while (t + step <= end) {
      t += step;
      emit(t, pos.lat, pos.lng, 0, null ?? 0, false, sessionId);
    }
    if (durMs >= 10 * 60_000) {
      veh.parks.push([
        uuid(),
        TENANT,
        v.vehicleId,
        'ENDED',
        iso(fromMs),
        iso(end),
        String(Math.round(durMs / 1000)),
        pos.lat.toFixed(6),
        pos.lng.toFixed(6),
        iso(fromMs),
      ]);
    }
    return end;
  }

  // Engine-hours rollup: bucket ignition-on seconds per local hour.
  function addEngineHours(fromMs, toMs) {
    let t = fromMs;
    while (t < toMs) {
      const d = localMs(t);
      const hourStart =
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()) -
        TZ_OFFSET_MS;
      const hourEnd = hourStart + 3600_000;
      const inHour = Math.min(toMs, hourEnd) - t;
      const key = String(hourStart);
      const agg = veh.engine.get(key) ?? { sec: 0, start: hourStart };
      agg.sec += inHour / 1000;
      veh.engine.set(key, agg);
      t = hourEnd;
    }
  }

  // ── day loop ───────────────────────────────────────────────────────────────
  const startMs = T0 - DAYS * 86_400_000;
  for (let dayStart = dayStartLocalMs(startMs); dayStart < T0; dayStart += 86_400_000) {
    const dow = localDow(dayStart);
    // Iran week: Sat(6)–Wed(3) work; Thu(4) 55%; Fri(5) 8%.
    const workProb = [0.92, 0.92, 0.92, 0.92, 0.55, 0.08, 0.95][dow];
    if (rnd() > workProb) continue; // off day — nothing emitted (device sleep)
    // Vehicle went permanently offline mid-window?
    const dayIndex = Math.round((dayStart - dayStartLocalMs(startMs)) / 86_400_000);
    if (OFFLINE_EARLY.has(v.idx) && dayIndex > DAYS - ri(3, 10)) break;

    const sessionId = uuid(); // one device session per work day

    // Shift window (local hours → UTC ms).
    let sLocal;
    let eLocal;
    if (night) {
      sLocal = rr(20, 22);
      eLocal = rr(31, 35);
    } // spans midnight
    else if (dow === 4) {
      sLocal = rr(7, 9);
      eLocal = rr(13, 15);
    } else {
      sLocal = rr(6, 8.6);
      eLocal = rr(15.5, 19.5);
    }
    const shiftStart = dayStart + sLocal * 3600_000;
    let shiftEnd = dayStart + eLocal * 3600_000;
    if (shiftEnd >= T0) shiftEnd = T0 - 60_000;
    if (shiftStart >= shiftEnd) continue;

    // Overnight pre-shift: parked heartbeat from day start (0:00) to shift start.
    pos = pos ?? { lat: depot.lat, lng: depot.lng };
    park(
      Math.max(dayStartLocalMs(startMs), dayStart - 2 * 3600_000),
      Math.max(0, shiftStart - (dayStart - 2 * 3600_000)),
      sessionId,
    );

    // 1-3 delivery rounds; each round = depot/last → POI(s) → back toward depot.
    let rounds = ri(1, 3);
    if (dow === 4) rounds = 1;
    let lastMs = shiftStart;
    for (let r = 0; r < rounds && lastMs < shiftEnd; r++) {
      const target = rnd() < 0.75 ? pick(regulars) : pick(POIS);
      // Pre-trip idle.
      let t0 = idleBefore(lastMs, sessionId);
      addEngineHours(lastMs, t0);
      if (t0 >= shiftEnd) break;
      // Drive there.
      const leg = driveLeg(pos, target, t0, sessionId);
      addEngineHours(t0, leg.endedAt);
      const tripId = uuid();
      const srcEvent = vehiclePositions[vehiclePositions.length - 1][0];
      veh.trips.push([
        tripId,
        TENANT,
        v.vehicleId,
        'COMPLETED',
        iso(t0 + 30_000),
        iso(leg.endedAt),
        pos.lat.toFixed(6),
        pos.lng.toFixed(6),
        leg.lastPos.lat.toFixed(6),
        leg.lastPos.lng.toFixed(6),
        leg.distanceKm.toFixed(2),
        String(Math.round((leg.endedAt - t0) / 1000)),
        leg.maxSpeed.toFixed(1),
        String(leg.stops),
        iso(t0),
        iso(leg.endedAt),
        srcEvent,
      ]);
      pos = leg.lastPos;
      lastMs = leg.endedAt;
      // Customer dwell (parked, ignition off).
      const dwellMs = ri(12, 45) * 60_000;
      const dwellEnd = park(lastMs, Math.min(dwellMs, Math.max(0, shiftEnd - lastMs)), sessionId);
      lastMs = dwellEnd;
      if (lastMs >= shiftEnd) break;
      // Return leg toward depot (maybe via another POI).
      const viaPoi = rnd() < 0.3 ? pick(regulars) : null;
      const leg2Target = viaPoi ?? { lat: depot.lat, lng: depot.lng };
      t0 = idleBefore(lastMs, sessionId);
      addEngineHours(lastMs, t0);
      if (t0 >= shiftEnd) break;
      const leg2 = driveLeg(pos, leg2Target, t0, sessionId);
      addEngineHours(t0, leg2.endedAt);
      const src2 = vehiclePositions[vehiclePositions.length - 1][0];
      veh.trips.push([
        uuid(),
        TENANT,
        v.vehicleId,
        'COMPLETED',
        iso(t0 + 30_000),
        iso(leg2.endedAt),
        pos.lat.toFixed(6),
        pos.lng.toFixed(6),
        leg2.lastPos.lat.toFixed(6),
        leg2.lastPos.lng.toFixed(6),
        leg2.distanceKm.toFixed(2),
        String(Math.round((leg2.endedAt - t0) / 1000)),
        leg2.maxSpeed.toFixed(1),
        String(leg2.stops),
        iso(t0),
        iso(leg2.endedAt),
        src2,
      ]);
      pos = leg2.lastPos;
      lastMs = leg2.endedAt;
      // Stop at intermediate POI or back at depot.
      const restMs = ri(10, 40) * 60_000;
      lastMs = park(lastMs, Math.min(restMs, Math.max(0, shiftEnd - lastMs)), sessionId);
    }

    // Post-shift overnight parking until end of day (capped at T0).
    if (lastMs < T0) park(lastMs, Math.min(T0 - lastMs, 86_400_000), sessionId);
  }

  files.positions.push(...vehiclePositions);
  files.trips.push(...veh.trips);
  files.parking.push(...veh.parks);
  files.idle.push(...veh.idles);
  for (const [, agg] of veh.engine) {
    files.engine.push([
      uuid(),
      TENANT,
      v.vehicleId,
      iso(agg.start),
      iso(agg.start + 3600_000),
      String(Math.round(agg.sec)),
      (agg.sec / 3600).toFixed(4),
      uuid(),
      iso(agg.start),
    ]);
  }
  files.deviceStatus.push([
    v.deviceId,
    TENANT,
    OFFLINE_EARLY.has(v.idx) ? 'OFFLINE' : 'OFFLINE',
    'meitrack',
    OFFLINE_EARLY.has(v.idx) ? 'NO_DATA' : 'REMOTE_DISCONNECT',
    iso(Math.min(T0 - 60_000, Date.parse(vehiclePositions.at(-1)?.[3] ?? iso(T0)))),
    iso(T0),
  ]);

  liveState.push({
    idx: v.idx,
    imei: v.imei,
    vehicleId: v.vehicleId,
    fleetCode: v.fleetCode,
    lat: pos.lat,
    lng: pos.lng,
    odoKm,
    offline: OFFLINE_EARLY.has(v.idx),
    aggressive,
  });
  process.stdout.write(
    `\r  vehicle ${v.idx + 1}/100 (${vehiclePositions.length.toLocaleString()} pos)`,
  );
}
console.log('');

// ── CSV dumps ────────────────────────────────────────────────────────────────
const csv = (rows) =>
  rows
    .map((r) =>
      r
        .map((f) =>
          typeof f === 'string' && (f.includes(',') || f.includes('"'))
            ? `"${f.replace(/"/g, '""')}"`
            : f,
        )
        .join(','),
    )
    .join('\n');
writeFileSync(`${OUT}/positions.csv`, csv(files.positions));
writeFileSync(`${OUT}/trips.csv`, csv(files.trips));
writeFileSync(`${OUT}/parking.csv`, csv(files.parking));
writeFileSync(`${OUT}/idle.csv`, csv(files.idle));
writeFileSync(`${OUT}/engine_hours.csv`, csv(files.engine));
writeFileSync(`${OUT}/device_status.csv`, csv(files.deviceStatus));
writeFileSync('/tmp/live-state.json', JSON.stringify(liveState));
console.log(
  `✓ CSVs written: ${files.positions.length.toLocaleString()} positions, ${files.trips.length.toLocaleString()} trips, ${files.parking.length.toLocaleString()} parking, ${files.idle.length.toLocaleString()} idle, ${files.engine.length.toLocaleString()} engine-hours`,
);
console.log('⚠ alerts/notifications/events generated by seed-alerts.mjs (needs rule ids).');
