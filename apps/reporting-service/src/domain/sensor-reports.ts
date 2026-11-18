/**
 * Readings that need per-vehicle calibration before they mean anything:
 *
 *   - Analog inputs (AIN1–AIN4): the tracker reports volts only. Which sensor
 *     is wired to an input, and how volts map to °C or fuel %, is stored in
 *     `fleet.vehicles.io_sensors` (validated by the fleet-management API).
 *   - Fuel level: analog fuel senders, CAN fuel percent, and the Meitrack CCE
 *     fuel percentage. LLS raw levels have no fixed unit and are not used.
 *
 * The functions here are pure; the SQL that fetches the raw rows lives in
 * FleetReportRepository, the grouping/totals in FleetReportService.
 */
import {
  TEMP_GAP_SEC,
  TEMP_PLAUSIBLE_MAX_C,
  TEMP_PLAUSIBLE_MIN_C,
  type TemperatureBounds,
} from './fleet-reports.js';

/** One calibration pair: input voltage → value (%, °C or V). */
export interface AnalogPoint {
  readonly v: number;
  readonly value: number;
}

export interface AnalogSensorConfig {
  /** Analog input key, e.g. `ain2`. */
  readonly input: string;
  readonly kind: 'fuel' | 'temperature' | 'voltage';
  readonly label: string | null;
  readonly tankLiters: number | null;
  readonly points: readonly AnalogPoint[];
}

/** Parse the per-vehicle `io_sensors` JSONB; invalid entries are skipped. */
export function parseIoSensors(value: unknown): AnalogSensorConfig[] {
  let list = value;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: AnalogSensorConfig[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const rec = raw as Record<string, unknown>;
    if (typeof rec.input !== 'string' || rec.input === '') continue;
    if (rec.kind !== 'fuel' && rec.kind !== 'temperature' && rec.kind !== 'voltage') continue;
    const points = parsePoints(rec.points);
    if (points.length < 2) continue;
    out.push({
      input: rec.input,
      kind: rec.kind,
      label: typeof rec.label === 'string' && rec.label.trim() !== '' ? rec.label.trim() : null,
      tankLiters: positiveNumber(rec.tankLiters),
      points,
    });
  }
  return out;
}

function parsePoints(value: unknown): AnalogPoint[] {
  if (!Array.isArray(value)) return [];
  const out: AnalogPoint[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as { v?: unknown; value?: unknown };
    if (typeof p.v !== 'number' || !Number.isFinite(p.v)) continue;
    if (typeof p.value !== 'number' || !Number.isFinite(p.value)) continue;
    out.push({ v: p.v, value: p.value });
  }
  return out.sort((a, b) => a.v - b.v);
}

/**
 * Volts → value through the calibration points (piecewise linear). Outside the
 * calibrated range the end value is held: a sender is never extrapolated.
 */
export function calibrateVolts(points: readonly AnalogPoint[], volts: number): number | null {
  const pts = points
    .filter((p) => Number.isFinite(p.v) && Number.isFinite(p.value))
    .sort((a, b) => a.v - b.v);
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (pts.length < 2 || !first || !last || !Number.isFinite(volts)) return null;
  if (volts <= first.v) return first.value;
  if (volts >= last.v) return last.value;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b) continue;
    if (volts <= b.v) {
      const span = b.v - a.v;
      if (span === 0) continue;
      const t = (volts - a.v) / span;
      return a.value + t * (b.value - a.value);
    }
  }
  return last.value;
}

// ── Analog temperature probes ────────────────────────────────────────────────

export interface AnalogTemperatureRow {
  readonly vehicleId: string;
  readonly at: Date;
  readonly lat: number;
  readonly lng: number;
  readonly analog: Readonly<Record<string, unknown>> | null;
  readonly ioSensors: unknown;
}

export interface AnalogTemperatureEpisode {
  readonly vehicleId: string;
  readonly sensor: string;
  readonly sensorLabel: string;
  readonly kind: 'HIGH' | 'LOW';
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly minC: number;
  readonly maxC: number;
  readonly avgC: number;
  readonly readings: number;
  readonly startLat: number;
  readonly startLng: number;
}

export interface AnalogTemperatureSensorStat {
  readonly vehicleId: string;
  readonly sensor: string;
  readonly sensorLabel: string;
  readonly readings: number;
  readonly minC: number;
  readonly maxC: number;
}

/**
 * Out-of-range periods of every analog temperature sender, using the same
 * rules as the SQL report: a run of consecutive readings on the same side of
 * the band, ended by the first reading back in range (when it follows within
 * TEMP_GAP_SEC), otherwise by the last out-of-range reading.
 */
export function analogTemperatureEpisodes(
  rows: readonly AnalogTemperatureRow[],
  bounds: TemperatureBounds,
  minDurationSec: number,
  gapSec = TEMP_GAP_SEC,
): { episodes: AnalogTemperatureEpisode[]; sensors: AnalogTemperatureSensorStat[] } {
  const byVehicle = new Map<string, AnalogTemperatureRow[]>();
  for (const row of rows) {
    const list = byVehicle.get(row.vehicleId);
    if (list) list.push(row);
    else byVehicle.set(row.vehicleId, [row]);
  }

  const episodes: AnalogTemperatureEpisode[] = [];
  const sensors: AnalogTemperatureSensorStat[] = [];
  for (const [vehicleId, list] of byVehicle) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
    const configs = parseIoSensors(list[0]?.ioSensors).filter((c) => c.kind === 'temperature');
    for (const cfg of configs) {
      const sensorLabel = cfg.label ?? cfg.input.toUpperCase();
      const byAt = new Map<number, { at: Date; lat: number; lng: number; c: number }>();
      for (const row of list) {
        const volts = numberOrNull(row.analog?.[cfg.input]);
        if (volts === null) continue;
        const calibrated = calibrateVolts(cfg.points, volts);
        if (calibrated === null || !Number.isFinite(calibrated)) continue;
        if (calibrated < TEMP_PLAUSIBLE_MIN_C || calibrated >= TEMP_PLAUSIBLE_MAX_C) continue;
        byAt.set(row.at.getTime(), {
          at: row.at,
          lat: row.lat,
          lng: row.lng,
          c: round2(calibrated),
        });
      }
      const readings = [...byAt.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
      if (readings.length === 0) continue;
      sensors.push({
        vehicleId,
        sensor: cfg.input,
        sensorLabel,
        readings: readings.length,
        minC: Math.min(...readings.map((r) => r.c)),
        maxC: Math.max(...readings.map((r) => r.c)),
      });
      for (const e of temperatureRuns(readings, bounds, minDurationSec, gapSec)) {
        episodes.push({ vehicleId, sensor: cfg.input, sensorLabel, ...e });
      }
    }
  }
  return { episodes, sensors };
}

interface TimedReading {
  readonly at: Date;
  readonly lat: number;
  readonly lng: number;
  readonly c: number;
}

function temperatureState(c: number, bounds: TemperatureBounds): 'HIGH' | 'LOW' | 'OK' {
  if (bounds.maxC !== null && c > bounds.maxC) return 'HIGH';
  if (bounds.minC !== null && c < bounds.minC) return 'LOW';
  return 'OK';
}

function temperatureRuns(
  readings: readonly TimedReading[],
  bounds: TemperatureBounds,
  minDurationSec: number,
  gapSec: number,
): Array<Omit<AnalogTemperatureEpisode, 'vehicleId' | 'sensor' | 'sensorLabel'>> {
  const points = readings.map((r) => ({ ...r, state: temperatureState(r.c, bounds) }));
  const out: Array<Omit<AnalogTemperatureEpisode, 'vehicleId' | 'sensor' | 'sensorLabel'>> = [];
  let i = 0;
  while (i < points.length) {
    const first = points[i];
    if (!first) break;
    if (first.state === 'OK') {
      i += 1;
      continue;
    }
    const kind = first.state;
    let last = i;
    let minC = first.c;
    let maxC = first.c;
    let sum = first.c;
    let count = 1;
    i += 1;
    while (i < points.length) {
      const cur = points[i];
      const prev = points[i - 1];
      if (!cur || !prev) break;
      if (cur.state !== kind) break;
      if ((cur.at.getTime() - prev.at.getTime()) / 1000 > gapSec) break;
      last = i;
      minC = Math.min(minC, cur.c);
      maxC = Math.max(maxC, cur.c);
      sum += cur.c;
      count += 1;
      i += 1;
    }
    const lastPoint = points[last];
    if (!lastPoint) break;
    const next = points[last + 1];
    const endedAtMs =
      next && (next.at.getTime() - lastPoint.at.getTime()) / 1000 <= gapSec
        ? next.at.getTime()
        : lastPoint.at.getTime();
    const durationSec = (endedAtMs - first.at.getTime()) / 1000;
    if (durationSec >= minDurationSec) {
      out.push({
        kind,
        startedAt: first.at,
        endedAt: new Date(endedAtMs),
        minC: round2(minC),
        maxC: round2(maxC),
        avgC: round2(sum / count),
        readings: count,
        startLat: first.lat,
        startLng: first.lng,
      });
    }
  }
  return out;
}

// ── Fuel level ───────────────────────────────────────────────────────────────

/** A fuel change over a window shorter than this is a fill / drop, not consumption. */
export const FUEL_WINDOW_SEC = 10 * 60;
/** Candidates closer than this belong to the same fill / drop. */
const FUEL_MERGE_GAP_SEC = 5 * 60;
const FUEL_MIN_PCT = 0;
const FUEL_MAX_PCT = 100;

export interface FuelReadingRow {
  readonly vehicleId: string;
  readonly at: Date;
  readonly lat: number;
  readonly lng: number;
  readonly analog: Readonly<Record<string, unknown>> | null;
  readonly fuel: Readonly<Record<string, unknown>> | null;
  readonly cceFuelPct: number | null;
  readonly ioSensors: unknown;
}

export interface FuelEvent {
  readonly vehicleId: string;
  readonly sensor: string;
  readonly sensorLabel: string;
  readonly kind: 'FILL' | 'DROP';
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly startPct: number;
  readonly endPct: number;
  readonly deltaPct: number;
  readonly deltaL: number | null;
  readonly startLat: number;
  readonly startLng: number;
}

export interface FuelSensorStat {
  readonly vehicleId: string;
  readonly sensor: string;
  readonly sensorLabel: string;
  readonly readings: number;
  readonly minPct: number;
  readonly maxPct: number;
  readonly lastPct: number;
}

interface FuelPoint {
  readonly at: Date;
  readonly lat: number;
  readonly lng: number;
  readonly pct: number;
}

interface FuelSeries {
  readonly sensor: string;
  readonly sensorLabel: string;
  readonly tankLiters: number | null;
  readonly points: Map<number, FuelPoint>;
}

/**
 * Fuel fills and drops of every vehicle in scope.
 *
 * For each reading the level is compared with the oldest reading of the
 * previous 10 minutes: a rise of at least `minDeltaPct` is a fill, a fall is a
 * drop. Normal consumption over 10 minutes stays below that, and longer
 * changes (a slow leak, a vehicle offline) are not attributed to one moment.
 * Adjacent candidates of the same kind are merged into one event.
 */
export function buildFuelEvents(
  rows: readonly FuelReadingRow[],
  options: { readonly minDeltaPct: number },
): { events: FuelEvent[]; sensors: FuelSensorStat[] } {
  const byVehicle = new Map<string, FuelReadingRow[]>();
  for (const row of rows) {
    const list = byVehicle.get(row.vehicleId);
    if (list) list.push(row);
    else byVehicle.set(row.vehicleId, [row]);
  }

  const events: FuelEvent[] = [];
  const sensors: FuelSensorStat[] = [];
  for (const [vehicleId, list] of byVehicle) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
    const series = new Map<string, FuelSeries>();
    const add = (
      sensor: string,
      sensorLabel: string,
      tankLiters: number | null,
      pct: number,
      row: FuelReadingRow,
    ) => {
      if (!Number.isFinite(pct) || pct < FUEL_MIN_PCT || pct > FUEL_MAX_PCT) return;
      let s = series.get(sensor);
      if (!s) {
        s = { sensor, sensorLabel, tankLiters, points: new Map() };
        series.set(sensor, s);
      }
      s.points.set(row.at.getTime(), {
        at: row.at,
        lat: row.lat,
        lng: row.lng,
        pct: round2(pct),
      });
    };

    const configs = parseIoSensors(list[0]?.ioSensors).filter((c) => c.kind === 'fuel');
    for (const row of list) {
      for (const cfg of configs) {
        const volts = numberOrNull(row.analog?.[cfg.input]);
        if (volts === null) continue;
        const pct = calibrateVolts(cfg.points, volts);
        if (pct === null) continue;
        add(cfg.input, cfg.label ?? cfg.input.toUpperCase(), cfg.tankLiters, pct, row);
      }
      const can = numberOrNull(row.fuel?.canFuelLevelPct);
      if (can !== null) add('canFuelLevelPct', 'CAN', null, can, row);
      if (row.cceFuelPct !== null) add('cceFuel', 'CCE', null, row.cceFuelPct, row);
    }

    for (const s of series.values()) {
      const points = [...s.points.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
      if (points.length === 0) continue;
      sensors.push({
        vehicleId,
        sensor: s.sensor,
        sensorLabel: s.sensorLabel,
        readings: points.length,
        minPct: Math.min(...points.map((p) => p.pct)),
        maxPct: Math.max(...points.map((p) => p.pct)),
        lastPct: points[points.length - 1]?.pct ?? 0,
      });
      for (const e of fuelRuns(points, s.tankLiters, options.minDeltaPct)) {
        events.push({ vehicleId, sensor: s.sensor, sensorLabel: s.sensorLabel, ...e });
      }
    }
  }
  return { events, sensors };
}

interface FuelCandidate {
  readonly kind: 'FILL' | 'DROP';
  start: FuelPoint;
  end: FuelPoint;
}

type FuelEventBody = Omit<FuelEvent, 'vehicleId' | 'sensor' | 'sensorLabel'>;

function fuelRuns(
  points: readonly FuelPoint[],
  tankLiters: number | null,
  minDeltaPct: number,
): FuelEventBody[] {
  const candidates: FuelCandidate[] = [];
  for (let i = 1; i < points.length; i++) {
    const cur = points[i];
    if (!cur) continue;
    let minIdx = -1;
    let maxIdx = -1;
    let minPct = Number.POSITIVE_INFINITY;
    let maxPct = Number.NEGATIVE_INFINITY;
    for (let j = i - 1; j >= 0; j--) {
      const p = points[j];
      if (!p || (cur.at.getTime() - p.at.getTime()) / 1000 > FUEL_WINDOW_SEC) break;
      if (p.pct < minPct) {
        minPct = p.pct;
        minIdx = j;
      }
      if (p.pct > maxPct) {
        maxPct = p.pct;
        maxIdx = j;
      }
    }
    const low = minIdx >= 0 ? points[minIdx] : undefined;
    if (low && cur.pct - minPct >= minDeltaPct) {
      candidates.push({ kind: 'FILL', start: low, end: cur });
    }
    const high = maxIdx >= 0 ? points[maxIdx] : undefined;
    if (high && maxPct - cur.pct >= minDeltaPct) {
      candidates.push({ kind: 'DROP', start: high, end: cur });
    }
  }
  candidates.sort(
    (a, b) =>
      a.start.at.getTime() - b.start.at.getTime() || a.end.at.getTime() - b.end.at.getTime(),
  );

  const merged: FuelCandidate[] = [];
  for (const c of candidates) {
    const prev = merged[merged.length - 1];
    if (
      prev !== undefined &&
      prev.kind === c.kind &&
      (c.start.at.getTime() - prev.end.at.getTime()) / 1000 <= FUEL_MERGE_GAP_SEC
    ) {
      if (c.end.at.getTime() > prev.end.at.getTime()) prev.end = c.end;
    } else {
      merged.push({ ...c });
    }
  }

  const out: FuelEventBody[] = [];
  for (const c of merged) {
    const deltaPct = round2(c.end.pct - c.start.pct);
    if (c.kind === 'FILL' ? deltaPct < minDeltaPct : deltaPct > -minDeltaPct) continue;
    out.push({
      kind: c.kind,
      startedAt: c.start.at,
      endedAt: c.end.at,
      startPct: c.start.pct,
      endPct: c.end.pct,
      deltaPct,
      deltaL: tankLiters !== null ? round2((deltaPct / 100) * tankLiters) : null,
      startLat: c.start.lat,
      startLng: c.start.lng,
    });
  }
  return out;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
