/**
 * Fleet-wide tabular reports — pure shaping logic.
 *
 *   - High speeds  (سرعت‌های بالا)      — every run of GPS fixes above a limit, for
 *     every vehicle, with its start, end, duration, top speed and the place of
 *     the top speed.
 *   - Mileage      (مسافت پیموده‌شده)   — kilometres per vehicle over a period,
 *     grouped by fleet with a subtotal per fleet and a grand total.
 *   - Temperature  (دمای مجاز)          — every period a cargo / fridge probe read
 *     outside the allowed range, with its start, end, duration, the extreme
 *     reading and where it began.
 *
 * Numbers come only from stored telemetry; nothing is estimated. The SQL that
 * reads the telemetry lives in FleetReportRepository; this file holds the
 * grouping, the totals and the spreadsheet layout so they can be unit-tested.
 */
import type { CsvLocale } from './csv-locale.js';
import { shamsiCells } from './shamsi.js';
import {
  type DiscardedFix,
  type SpeedFix,
  groupSpeedingEpisodes,
  screenSpeedFixes,
} from './speeding-events.js';
import type { SheetCell, SheetSpec } from './xlsx.js';

/** Local time of the exported sheets (same zone as every other report). */
export const REPORT_TIME_ZONE = 'Asia/Tehran';

// ── High speeds ──────────────────────────────────────────────────────────────

export interface OverspeedEpisodeRow {
  readonly vehicleId: string;
  readonly label: string;
  readonly fleetName: string | null;
  /** 1-based number of the episode within its vehicle (as the legacy report numbers them). */
  readonly seq: number;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationSec: number;
  readonly maxSpeedKmh: number;
  readonly avgSpeedKmh: number;
  readonly fixCount: number;
  readonly peak: { readonly at: string; readonly lat: number; readonly lng: number };
}

export interface VehicleRef {
  readonly vehicleId: string;
  readonly label: string;
  readonly fleetName: string | null;
}

/**
 * Speeding episodes of many vehicles. Each vehicle's over-limit fixes are
 * screened against its own surrounding fixes (GPS spikes set aside), grouped
 * into runs, and runs shorter than `minDurationSec` dropped. Rows come out
 * ordered by vehicle label, then time.
 */
export function fleetOverspeedEpisodes(
  vehicles: readonly VehicleRef[],
  fixesByVehicle: ReadonlyMap<string, readonly SpeedFix[]>,
  contextByVehicle: ReadonlyMap<string, readonly SpeedFix[]>,
  options: { readonly limitKmh: number; readonly minDurationSec: number },
): { rows: OverspeedEpisodeRow[]; discarded: number } {
  const rows: OverspeedEpisodeRow[] = [];
  let discarded = 0;
  const ordered = [...vehicles].sort(byLabel);
  for (const v of ordered) {
    const fixes = fixesByVehicle.get(v.vehicleId);
    if (!fixes || fixes.length === 0) continue;
    const screened: { kept: SpeedFix[]; discarded: DiscardedFix[] } = screenSpeedFixes(
      fixes,
      contextByVehicle.get(v.vehicleId) ?? [],
      { limitKmh: options.limitKmh },
    );
    discarded += screened.discarded.length;
    let seq = 0;
    for (const e of groupSpeedingEpisodes(screened.kept, { limitKmh: options.limitKmh })) {
      if (e.durationSec < options.minDurationSec) continue;
      seq += 1;
      rows.push({
        vehicleId: v.vehicleId,
        label: v.label,
        fleetName: v.fleetName,
        seq,
        startedAt: e.startedAt.toISOString(),
        endedAt: e.endedAt.toISOString(),
        durationSec: e.durationSec,
        maxSpeedKmh: e.maxSpeedKmh,
        avgSpeedKmh: e.avgSpeedKmh,
        fixCount: e.fixCount,
        peak: { at: e.peak.at.toISOString(), lat: e.peak.lat, lng: e.peak.lng },
      });
    }
  }
  return { rows, discarded };
}

function byLabel(a: { label: string }, b: { label: string }): number {
  return a.label.localeCompare(b.label, 'en', { numeric: true, sensitivity: 'base' });
}

// ── Mileage ──────────────────────────────────────────────────────────────────

export interface MileageVehicleRow {
  readonly vehicleId: string;
  readonly label: string;
  readonly fleetId: string | null;
  readonly fleetName: string | null;
  readonly distanceKm: number;
  readonly trips: number;
}

export interface MileageGroup {
  readonly fleetId: string | null;
  readonly fleetName: string | null;
  readonly rows: readonly MileageVehicleRow[];
  readonly subtotalKm: number;
  readonly vehicleCount: number;
}

export interface MileageReport {
  readonly groups: readonly MileageGroup[];
  readonly totalKm: number;
  readonly vehicleCount: number;
  /** Vehicles left out because they covered no distance (only when hideZero). */
  readonly hiddenZeroCount: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Group per-vehicle mileage by fleet: a subtotal per fleet and a grand total,
 * fleets by name with "no fleet" last, vehicles by label. With `hideZero`,
 * vehicles that did not move are left out (and counted in `hiddenZeroCount`).
 */
export function buildMileageReport(
  rows: readonly MileageVehicleRow[],
  options: { readonly hideZero: boolean },
): MileageReport {
  const shown = options.hideZero ? rows.filter((r) => r.distanceKm > 0) : [...rows];
  const byFleet = new Map<string, MileageVehicleRow[]>();
  for (const r of shown) {
    const key = r.fleetId ?? '';
    const list = byFleet.get(key);
    if (list) list.push(r);
    else byFleet.set(key, [r]);
  }
  const groups: MileageGroup[] = [...byFleet.values()].map((list) => {
    const sorted = [...list].sort(byLabel);
    const first = sorted[0] as MileageVehicleRow;
    return {
      fleetId: first.fleetId,
      fleetName: first.fleetName,
      rows: sorted.map((r) => ({ ...r, distanceKm: round2(r.distanceKm) })),
      subtotalKm: round2(sorted.reduce((s, r) => s + r.distanceKm, 0)),
      vehicleCount: sorted.length,
    };
  });
  groups.sort((a, b) => {
    if (a.fleetId === null) return 1;
    if (b.fleetId === null) return -1;
    return (a.fleetName ?? '').localeCompare(b.fleetName ?? '', 'en', { numeric: true });
  });
  return {
    groups,
    totalKm: round2(shown.reduce((s, r) => s + r.distanceKm, 0)),
    vehicleCount: shown.length,
    hiddenZeroCount: rows.length - shown.length,
  };
}

// ── Temperature ──────────────────────────────────────────────────────────────

/** Readings outside this band are sensor faults (DS18B20 reports 85 °C on reset, -127 on error). */
export const TEMP_PLAUSIBLE_MIN_C = -55;
export const TEMP_PLAUSIBLE_MAX_C = 85;

/** A gap longer than this between two readings of a probe ends a period (device offline). */
export const TEMP_GAP_SEC = 15 * 60;

export interface TemperatureBounds {
  readonly minC: number | null;
  readonly maxC: number | null;
}

export type TemperatureBoundsError = 'MISSING' | 'INVALID' | 'REVERSED';

/** Parse the allowed band; at least one side is required. */
export function parseTemperatureBounds(
  minRaw: unknown,
  maxRaw: unknown,
): { bounds: TemperatureBounds; error?: undefined } | { error: TemperatureBoundsError } {
  const parse = (v: unknown): number | null | 'bad' => {
    if (v === undefined || v === null || String(v).trim() === '') return null;
    const n = Number(String(v).trim());
    return Number.isFinite(n) && n >= -100 && n <= 200 ? n : 'bad';
  };
  const minC = parse(minRaw);
  const maxC = parse(maxRaw);
  if (minC === 'bad' || maxC === 'bad') return { error: 'INVALID' };
  if (minC === null && maxC === null) return { error: 'MISSING' };
  if (minC !== null && maxC !== null && minC > maxC) return { error: 'REVERSED' };
  return { bounds: { minC, maxC } };
}

export interface TemperatureEpisodeRow {
  readonly vehicleId: string;
  readonly label: string;
  readonly fleetName: string | null;
  /** Probe id, e.g. `temp1` (Teltonika 1-Wire), `lls1Temp`, `cce2` (Meitrack slot 2). */
  readonly sensor: string;
  readonly seq: number;
  /** HIGH = above the allowed maximum, LOW = below the allowed minimum. */
  readonly kind: 'HIGH' | 'LOW';
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationSec: number;
  readonly minC: number;
  readonly maxC: number;
  readonly avgC: number;
  readonly readings: number;
  /** Where the period began. */
  readonly start: { readonly lat: number; readonly lng: number };
}

export interface TemperatureSensorStat {
  readonly vehicleId: string;
  readonly label: string;
  readonly sensor: string;
  readonly readings: number;
  readonly minC: number;
  readonly maxC: number;
}

/** Human name of a probe id. */
export function sensorLabel(sensor: string): string {
  const m = /^(?:temp|cce)(\d+)$/.exec(sensor);
  if (m) return `T${m[1]}`;
  const lls = /^lls(\d)Temp$/.exec(sensor);
  if (lls) return `LLS${lls[1]}`;
  return sensor;
}

// ── Durations ────────────────────────────────────────────────────────────────

/** `2 ساعت 21 دقیقه 0 ثانیه` / `2h 21m 0s` — the legacy report's wording. */
export function formatDuration(sec: number, locale: CsvLocale): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (locale === 'fa') {
    return h > 0 ? `${h} ساعت ${m} دقیقه ${r} ثانیه` : `${m} دقیقه ${r} ثانیه`;
  }
  return h > 0 ? `${h}h ${m}m ${r}s` : `${m}m ${r}s`;
}

// ── Spreadsheets ─────────────────────────────────────────────────────────────

const T: Record<CsvLocale, Record<string, string>> = {
  fa: {
    period: 'دوره:',
    overspeedTitle: 'سرعت‌های بالا',
    mileageTitle: 'مسافت پیموده‌شده متحرک‌ها',
    temperatureTitle: 'دمای مجاز',
    no: '#',
    vehicle: 'نام متحرک',
    fleet: 'ناوگان',
    startDate: 'تاریخ شروع',
    startTime: 'ساعت شروع',
    endDate: 'تاریخ پایان',
    endTime: 'ساعت پایان',
    duration: 'مدت زمان',
    durationSec: 'مدت (ثانیه)',
    maxSpeed: 'بالاترین سرعت (km/h)',
    avgSpeed: 'میانگین سرعت (km/h)',
    limit: 'حد سرعت (km/h)',
    peakLat: 'عرض جغرافیایی بالاترین سرعت',
    peakLng: 'طول جغرافیایی بالاترین سرعت',
    from: 'از',
    to: 'تا',
    distance: 'مسافت (کیلومتر)',
    trips: 'تعداد سفر',
    subtotal: 'جمع ناوگان',
    total: 'جمع کل',
    noFleet: 'بدون ناوگان',
    sensor: 'سنسور',
    kind: 'نوع',
    high: 'بالاتر از حد مجاز',
    low: 'پایین‌تر از حد مجاز',
    minTemp: 'حداقل دما (°C)',
    maxTemp: 'حداکثر دما (°C)',
    avgTemp: 'میانگین دما (°C)',
    lat: 'عرض جغرافیایی',
    lng: 'طول جغرافیایی',
    allowed: 'بازهٔ مجاز (°C)',
  },
  en: {
    period: 'Period:',
    overspeedTitle: 'High speeds',
    mileageTitle: 'Mileage',
    temperatureTitle: 'Temperature out of range',
    no: '#',
    vehicle: 'Vehicle',
    fleet: 'Fleet',
    startDate: 'Start date',
    startTime: 'Start time',
    endDate: 'End date',
    endTime: 'End time',
    duration: 'Duration',
    durationSec: 'Duration (s)',
    maxSpeed: 'Top speed (km/h)',
    avgSpeed: 'Average speed (km/h)',
    limit: 'Limit (km/h)',
    peakLat: 'Top speed latitude',
    peakLng: 'Top speed longitude',
    from: 'From',
    to: 'To',
    distance: 'Distance (km)',
    trips: 'Trips',
    subtotal: 'Fleet subtotal',
    total: 'Grand total',
    noFleet: 'No fleet',
    sensor: 'Sensor',
    kind: 'Kind',
    high: 'Above maximum',
    low: 'Below minimum',
    minTemp: 'Min temperature (°C)',
    maxTemp: 'Max temperature (°C)',
    avgTemp: 'Avg temperature (°C)',
    lat: 'Latitude',
    lng: 'Longitude',
    allowed: 'Allowed range (°C)',
  },
};

function stamp(value: string | Date): string {
  const [date, time] = shamsiCells(value, REPORT_TIME_ZONE);
  return `${date} ${time}`.trim();
}

function periodRow(locale: CsvLocale, from: Date, to: Date): SheetCell[] {
  return [T[locale].period, `${stamp(from)} - ${stamp(to)}`];
}

export interface SheetWindow {
  readonly from: Date;
  readonly to: Date;
}

export function overspeedSheet(
  rows: readonly OverspeedEpisodeRow[],
  win: SheetWindow,
  limitKmh: number,
  locale: CsvLocale,
): SheetSpec {
  const t = T[locale];
  const body: SheetCell[][] = rows.map((r) => [
    r.seq,
    r.label,
    ...shamsiCells(r.startedAt, REPORT_TIME_ZONE),
    ...shamsiCells(r.endedAt, REPORT_TIME_ZONE),
    formatDuration(r.durationSec, locale),
    r.durationSec,
    r.maxSpeedKmh,
    r.avgSpeedKmh,
    r.peak.lat,
    r.peak.lng,
  ]);
  return {
    name: t.overspeedTitle as string,
    rtl: locale === 'fa',
    rows: [
      [t.overspeedTitle],
      periodRow(locale, win.from, win.to),
      [t.limit, limitKmh],
      [],
      [
        t.no,
        t.vehicle,
        t.startDate,
        t.startTime,
        t.endDate,
        t.endTime,
        t.duration,
        t.durationSec,
        t.maxSpeed,
        t.avgSpeed,
        t.peakLat,
        t.peakLng,
      ],
      ...body,
    ],
  };
}

export function mileageSheet(
  report: MileageReport,
  win: SheetWindow,
  locale: CsvLocale,
): SheetSpec {
  const t = T[locale];
  const [fromDate, fromTime] = shamsiCells(win.from, REPORT_TIME_ZONE);
  const [toDate, toTime] = shamsiCells(win.to, REPORT_TIME_ZONE);
  const from = `${fromDate} ${fromTime}`;
  const to = `${toDate} ${toTime}`;
  const body: SheetCell[][] = [];
  let n = 0;
  for (const g of report.groups) {
    for (const r of g.rows) {
      n += 1;
      body.push([n, r.label, g.fleetName ?? t.noFleet, from, to, r.distanceKm, r.trips]);
    }
    if (report.groups.length > 1) {
      body.push(['', `${t.subtotal}: ${g.fleetName ?? t.noFleet}`, '', '', '', g.subtotalKm, '']);
    }
  }
  body.push(['', t.total, '', '', '', report.totalKm, '']);
  return {
    name: t.mileageTitle as string,
    rtl: locale === 'fa',
    rows: [
      [t.mileageTitle],
      periodRow(locale, win.from, win.to),
      [],
      [t.no, t.vehicle, t.fleet, t.from, t.to, t.distance, t.trips],
      ...body,
    ],
  };
}

export function temperatureSheet(
  rows: readonly TemperatureEpisodeRow[],
  win: SheetWindow,
  bounds: TemperatureBounds,
  locale: CsvLocale,
): SheetSpec {
  const t = T[locale];
  const band = `${bounds.minC ?? '-∞'} … ${bounds.maxC ?? '+∞'}`;
  return {
    name: t.temperatureTitle as string,
    rtl: locale === 'fa',
    rows: [
      [t.temperatureTitle],
      periodRow(locale, win.from, win.to),
      [t.allowed, band],
      [],
      [
        t.no,
        t.vehicle,
        t.sensor,
        t.kind,
        t.startDate,
        t.startTime,
        t.endDate,
        t.endTime,
        t.duration,
        t.durationSec,
        t.minTemp,
        t.maxTemp,
        t.avgTemp,
        t.lat,
        t.lng,
      ],
      ...rows.map((r): SheetCell[] => [
        r.seq,
        r.label,
        sensorLabel(r.sensor),
        r.kind === 'HIGH' ? t.high : t.low,
        ...shamsiCells(r.startedAt, REPORT_TIME_ZONE),
        ...shamsiCells(r.endedAt, REPORT_TIME_ZONE),
        formatDuration(r.durationSec, locale),
        r.durationSec,
        r.minC,
        r.maxC,
        r.avgC,
        r.start.lat,
        r.start.lng,
      ]),
    ],
  };
}

// ── Objects (live fleet status) ──────────────────────────────────────────────

/** One vehicle with its tracker and its newest stored fix (legacy "objects" list). */
export interface ObjectStatusRow {
  readonly vehicleId: string;
  readonly name: string;
  readonly imei: string | null;
  readonly plate: string | null;
  readonly fleetName: string | null;
  readonly model: string | null;
  readonly vin: string | null;
  readonly simNumber: string | null;
  /** Vehicle and tracker active (not archived / suspended). */
  readonly active: boolean;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly speedKmh: number | null;
  readonly altitudeM: number | null;
  readonly headingDeg: number | null;
  readonly odometerKm: number | null;
  readonly engineHours: number | null;
  /** Device time of the newest fix. */
  readonly lastFixAt: string | null;
  /** When the server stored it. */
  readonly lastReceivedAt: string | null;
  /** Connection state of the tracker (ONLINE / OFFLINE / STALE); null when never connected. */
  readonly connection: string | null;
}

const OBJECT_HEADERS: Record<CsvLocale, string[]> = {
  fa: [
    'نام',
    'IMEI',
    'پلاک',
    'گروه',
    'مدل',
    'VIN',
    'شماره سیم کارت',
    'فعال',
    'عرض جغرافیایی',
    'طول جغرافیایی',
    'سرعت',
    'ارتفاع',
    'زاویه',
    'مسافت سنج',
    'کارکرد ساعت موتور',
    'آخرین زمان ارسال متحرک',
    'آخرین زمان ارسال سرور',
  ],
  en: [
    'Name',
    'IMEI',
    'Plate',
    'Group',
    'Model',
    'VIN',
    'SIM number',
    'Active',
    'Latitude',
    'Longitude',
    'Speed',
    'Altitude',
    'Angle',
    'Odometer',
    'Engine hours',
    'Last device time',
    'Last server time',
  ],
};

export function objectsHeader(locale: CsvLocale): string[] {
  return [...OBJECT_HEADERS[locale]];
}

/** Cells in the legacy column order; times as local `date time` (Shamsi in fa). */
export function objectCells(r: ObjectStatusRow, locale: CsvLocale): SheetCell[] {
  const when = (iso: string | null) => {
    if (!iso) return '';
    if (locale === 'fa') return stamp(iso);
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: REPORT_TIME_ZONE,
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(new Date(iso));
  };
  return [
    r.name,
    r.imei ?? '',
    r.plate ?? '',
    r.fleetName ?? '',
    r.model ?? '',
    r.vin ?? '',
    r.simNumber ?? '',
    r.active ? 1 : 0,
    r.lat ?? '',
    r.lng ?? '',
    r.speedKmh ?? '',
    r.altitudeM ?? '',
    r.headingDeg ?? '',
    r.odometerKm ?? '',
    r.engineHours ?? '',
    when(r.lastFixAt),
    when(r.lastReceivedAt),
  ];
}

export function objectsSheet(rows: readonly ObjectStatusRow[], locale: CsvLocale): SheetSpec {
  return {
    name: locale === 'fa' ? 'متحرک‌ها' : 'Objects',
    rtl: locale === 'fa',
    rows: [objectsHeader(locale), ...rows.map((r) => objectCells(r, locale))],
  };
}
