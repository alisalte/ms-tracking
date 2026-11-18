/**
 * Legacy tracking-system unit exports → rows for `POST /vehicles/legacy-import`.
 *
 * Two formats are recognised from their header row:
 *   - objects   — the previous system's "objects" CSV:
 *                 نام, IMEI, پلاک, گروه, مدل, VIN, شماره سیم کارت, فعال, …, مسافت سنج, کارکرد ساعت موتور, …
 *   - wialon    — a Wialon "Units" sheet: Name, Creator, Device type, Deactivation, UID,
 *                 Phone, Last message, Created, Groups, Custom fields
 *
 * Each row is one tracker (IMEI) on one vehicle. Groups become fleets through
 * `assignFleets`: the operator picks which legacy groups are fleets.
 */
import { parseTabularFile } from '@/lib/spreadsheet';

export type LegacyFormat = 'objects' | 'wialon';

export interface LegacyUnitDraft {
  /** 1-based sheet row (header = 1). */
  row: number;
  name: string;
  imei: string;
  plate?: string;
  vin?: string;
  model?: string;
  simNumber?: string;
  active?: boolean;
  odometerKm?: number;
  engineHours?: number;
  groups: string[];
  legacyFields?: Record<string, string>;
  /** As exported (shown in the preview only). */
  lastMessage?: string;
}

export type LegacyIssueCode = 'missingName' | 'invalidImei' | 'imeiLuhn' | 'duplicateImei';

export interface LegacyIssue {
  row: number;
  code: LegacyIssueCode;
}

export interface ParsedLegacyFile {
  format: LegacyFormat;
  units: LegacyUnitDraft[];
  issues: LegacyIssue[];
  /** Distinct legacy groups with how many units carry each, most common first. */
  groups: Array<{ name: string; count: number }>;
}

export class LegacyFileError extends Error {
  constructor(public readonly code: 'unknownFormat' | 'empty') {
    super(code);
  }
}

const INVISIBLE = /[​‌﻿⁠ ‎‏‪-‮‍]/g;
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function clean(raw: string | undefined): string {
  return (raw ?? '')
    .normalize('NFKC')
    .replace(INVISIBLE, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function digits(raw: string): string {
  return clean(raw)
    .replace(/[۰-۹]/g, (c) => String(FA_DIGITS.indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String(AR_DIGITS.indexOf(c)));
}

function header(h: string): string {
  return clean(h)
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function luhn(d: string): boolean {
  let sum = 0;
  for (let i = 0; i < d.length; i += 1) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** IMEI cell → digits (an Excel `3.5E+14` cell is expanded). */
export function normalizeLegacyImei(raw: string): string {
  const t = digits(raw).replace(/,/g, '');
  if (/^\d+\.?\d*e\+?\d+$/i.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n)) return String(Math.round(n));
  }
  return t.replace(/\D/g, '');
}

function positive(raw: string): number | undefined {
  const t = digits(raw).replace(/,/g, '');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 && n <= 10_000_000 ? Math.round(n * 100) / 100 : undefined;
}

/** Wialon "Custom fields" cell: `رديف: 22-1, شماره سیمکارت: 0901…, شیفت دما: +3`. */
export function parseCustomFields(raw: string): Record<string, string> | undefined {
  const text = clean(raw);
  if (!text) return undefined;
  const out: Record<string, string> = {};
  for (const part of text.split(/,\s*(?=[^,:]{1,60}:\s)/)) {
    const i = part.indexOf(':');
    if (i <= 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key && value) out[key.slice(0, 200)] = value.slice(0, 2000);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const OBJECTS_COLS = {
  name: ['نام', 'name'],
  imei: ['imei'],
  plate: ['پلاک', 'plate'],
  group: ['گروه', 'group'],
  model: ['مدل', 'model'],
  vin: ['vin'],
  sim: ['شمارهسیمکارت', 'sim', 'simnumber'],
  active: ['فعال', 'active'],
  odometer: ['مسافتسنج', 'odometer'],
  engineHours: ['کارکردساعتموتور', 'enginehours'],
  lastMessage: ['آخرینزمانارسالمتحرک'],
} as const;

const WIALON_COLS = {
  name: ['name', 'نام'],
  imei: ['uid', 'uniqueid', 'شناسهیکتا'],
  model: ['devicetype', 'نوعدستگاه'],
  sim: ['phone', 'phonenumber', 'شمارهتلفن'],
  deactivation: ['deactivation'],
  groups: ['groups', 'گروهها'],
  custom: ['customfields', 'فیلدهایسفارشی'],
  lastMessage: ['lastmessage', 'آخرینپیام'],
} as const;

function columns<K extends string>(
  row: string[],
  spec: Record<K, readonly string[]>,
): Partial<Record<K, number>> {
  const keys = row.map(header);
  const out: Partial<Record<K, number>> = {};
  for (const [field, aliases] of Object.entries(spec) as Array<[K, readonly string[]]>) {
    const i = keys.findIndex((k) => aliases.includes(k));
    if (i >= 0) out[field] = i;
  }
  return out;
}

/** Recognise the format and read every unit; issues are listed, not thrown. */
export function parseLegacyGrid(grid: string[][]): ParsedLegacyFile {
  const headerIndex = grid.findIndex((r) => r.some((c) => clean(c) !== ''));
  if (headerIndex < 0) throw new LegacyFileError('empty');
  const head = grid[headerIndex] ?? [];
  const w = columns(head, WIALON_COLS);
  const o = columns(head, OBJECTS_COLS);
  const format: LegacyFormat | null =
    w.name !== undefined && w.imei !== undefined && w.groups !== undefined
      ? 'wialon'
      : o.name !== undefined && o.imei !== undefined
        ? 'objects'
        : null;
  if (!format) throw new LegacyFileError('unknownFormat');

  const units: LegacyUnitDraft[] = [];
  const issues: LegacyIssue[] = [];
  const seen = new Map<string, number>();
  const cell = (r: string[], i: number | undefined) => (i === undefined ? '' : (r[i] ?? ''));

  grid.slice(headerIndex + 1).forEach((r, k) => {
    if (r.every((c) => clean(c) === '')) return;
    const row = headerIndex + k + 2;
    let unit: LegacyUnitDraft;
    if (format === 'objects') {
      const group = clean(cell(r, o.group));
      const active = clean(cell(r, o.active));
      unit = {
        row,
        name: clean(cell(r, o.name)),
        imei: normalizeLegacyImei(cell(r, o.imei)),
        plate: clean(cell(r, o.plate)) || undefined,
        vin: clean(cell(r, o.vin)) || undefined,
        model: clean(cell(r, o.model)) || undefined,
        simNumber: clean(cell(r, o.sim)) || undefined,
        active: active === '' ? undefined : active !== '0',
        odometerKm: positive(cell(r, o.odometer)),
        engineHours: positive(cell(r, o.engineHours)),
        groups: group ? [group] : [],
        lastMessage: clean(cell(r, o.lastMessage)) || undefined,
      };
    } else {
      const groups = clean(cell(r, w.groups))
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean);
      unit = {
        row,
        name: clean(cell(r, w.name)),
        imei: normalizeLegacyImei(cell(r, w.imei)),
        model: clean(cell(r, w.model)) || undefined,
        simNumber: clean(cell(r, w.sim)) || undefined,
        active: clean(cell(r, w.deactivation)) === '' ? undefined : false,
        groups,
        legacyFields: parseCustomFields(cell(r, w.custom)),
        lastMessage: clean(cell(r, w.lastMessage)) || undefined,
      };
    }
    if (!unit.name) issues.push({ row, code: 'missingName' });
    if (!/^\d{15}$/.test(unit.imei)) issues.push({ row, code: 'invalidImei' });
    else if (!luhn(unit.imei)) issues.push({ row, code: 'imeiLuhn' });
    else if (seen.has(unit.imei)) issues.push({ row, code: 'duplicateImei' });
    seen.set(unit.imei, row);
    units.push(unit);
  });

  const counts = new Map<string, number>();
  for (const u of units) for (const g of u.groups) counts.set(g, (counts.get(g) ?? 0) + 1);
  const groups = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { format, units, issues, groups };
}

export async function parseLegacyFile(file: File): Promise<ParsedLegacyFile> {
  return parseLegacyGrid(await parseTabularFile(file));
}

/**
 * Fleet of each unit: the first of its own groups (in the unit's order) that
 * the operator marked as a fleet; otherwise the fallback fleet.
 */
export function assignFleets(
  units: readonly LegacyUnitDraft[],
  fleetGroups: ReadonlySet<string>,
  fallback: string,
): Map<number, string> {
  const out = new Map<number, string>();
  for (const u of units) {
    out.set(u.row, u.groups.find((g) => fleetGroups.has(g)) ?? fallback);
  }
  return out;
}

/** Wire rows for the import endpoint (units with issues are left out by the caller). */
export function toLegacyImportRows(
  units: readonly LegacyUnitDraft[],
  fleets: ReadonlyMap<number, string>,
  fallback: string,
): Array<Record<string, unknown>> {
  return units.map((u) => ({
    row: u.row,
    name: u.name,
    imei: u.imei,
    fleet: fleets.get(u.row) ?? fallback,
    ...(u.plate ? { plate: u.plate } : {}),
    ...(u.vin && /^[A-HJ-NPR-Z0-9]{1,17}$/i.test(u.vin) ? { vin: u.vin } : {}),
    ...(u.model ? { model: u.model } : {}),
    ...(u.simNumber ? { simNumber: u.simNumber } : {}),
    ...(u.active !== undefined ? { active: u.active } : {}),
    ...(u.odometerKm !== undefined ? { odometerKm: u.odometerKm } : {}),
    ...(u.engineHours !== undefined ? { engineHours: u.engineHours } : {}),
    ...(u.legacyFields ? { legacyFields: u.legacyFields } : {}),
    ...(u.groups.length > 0 ? { groups: u.groups } : {}),
  }));
}

export type LegacyProtocol = 'gt06' | 'jt808' | 'meitrack' | 'teltonika' | 'stub';

/** Same rule as the server: protocol named by a legacy model, or null. */
export function legacyProtocolForModel(model: string | undefined): LegacyProtocol | null {
  if (!model) return null;
  const m = model.trim().replace(/\s+/g, ' ');
  if (/teltonika/i.test(m)) return 'teltonika';
  if (/^(1[01]\d\d|4[12]00)$/.test(m)) return 'teltonika';
  if (/^(FM[A-Z]?\d|FMB|FMC|FMM|FMP|FMT|FMU|FMA|TFT|TAT|TMT|MTB|GH\d)/i.test(m)) return 'teltonika';
  if (/meitrack|^MT\d|^T3\d\d|^T6\d\d|^P99|^TC68|^MD\d/i.test(m)) return 'meitrack';
  if (/gt06|concox|^GT\d|^JM-?VL|^JM\d/i.test(m)) return 'gt06';
  if (/jt-?808|jt-?1078/i.test(m)) return 'jt808';
  return null;
}
