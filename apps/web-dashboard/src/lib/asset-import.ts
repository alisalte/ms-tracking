/**
 * Map a spreadsheet grid onto vehicle / device import rows.
 *
 * Headers accept English and Persian aliases. IMEI is stripped of separators
 * and expanded from Excel scientific notation when it still looks like 15 digits.
 */
import { SpreadsheetParseError, buildXlsx, parseTabularFile, trimGrid } from '@/lib/spreadsheet';
import type { DeviceProtocol } from '@/types/asset.types';

export const ASSET_IMPORT_MAX_ROWS = 500;

export type AssetImportKind = 'vehicles' | 'devices';

export interface VehicleImportDraft {
  row: number;
  name: string;
  code: string;
  fleetCode: string;
  plate?: string;
  vin?: string;
  odometerKm?: number;
  engineHours?: number;
}

export interface DeviceImportDraft {
  row: number;
  imei: string;
  protocol: DeviceProtocol;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  vehicleCode?: string;
}

export interface ImportRowIssue {
  row: number;
  field?: string;
  code: string;
}

export interface ParsedAssetImport<T> {
  kind: AssetImportKind;
  rows: T[];
  issues: ImportRowIssue[];
}

const PROTOCOLS = new Set<DeviceProtocol>(['gt06', 'jt808', 'meitrack', 'stub']);

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '').replace(/[_-]+/g, '');
}

const VEHICLE_ALIASES: Record<string, keyof Omit<VehicleImportDraft, 'row'>> = {
  name: 'name',
  نام: 'name',
  vehiclename: 'name',
  code: 'code',
  کد: 'code',
  vehiclecode: 'code',
  vehicle: 'code',
  fleetcode: 'fleetCode',
  fleet: 'fleetCode',
  کدناوگان: 'fleetCode',
  ناوگان: 'fleetCode',
  plate: 'plate',
  پلاک: 'plate',
  license: 'plate',
  licenceplate: 'plate',
  vin: 'vin',
  وین: 'vin',
  شاسی: 'vin',
  odometer: 'odometerKm',
  odometerkm: 'odometerKm',
  mileage: 'odometerKm',
  km: 'odometerKm',
  کارکرد: 'odometerKm',
  کیلومترشمار: 'odometerKm',
  کیلومتر: 'odometerKm',
  اودومتر: 'odometerKm',
  کانترکیلومتر: 'odometerKm',
  enginehours: 'engineHours',
  enginehour: 'engineHours',
  hours: 'engineHours',
  hourmeter: 'engineHours',
  runtime: 'engineHours',
  counter: 'engineHours',
  motohours: 'engineHours',
  ساعتموتور: 'engineHours',
  ساعتکار: 'engineHours',
  کانترساعت: 'engineHours',
  کارکردساعت: 'engineHours',
  کانتر: 'engineHours',
};

const DEVICE_ALIASES: Record<string, keyof Omit<DeviceImportDraft, 'row'>> = {
  imei: 'imei',
  protocol: 'protocol',
  پروتکل: 'protocol',
  serialnumber: 'serialNumber',
  serial: 'serialNumber',
  سریال: 'serialNumber',
  شماره‌سریال: 'serialNumber',
  شمارهسریال: 'serialNumber',
  manufacturer: 'manufacturer',
  سازنده: 'manufacturer',
  model: 'model',
  مدل: 'model',
  vehiclecode: 'vehicleCode',
  vehicle: 'vehicleCode',
  کدخودرو: 'vehicleCode',
  خودرو: 'vehicleCode',
};

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let n = Number(digits[digits.length - 1 - i]);
    if (Number.isNaN(n)) return false;
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

function expandExcelNumber(raw: string): string {
  const t = raw.trim().replace(/,/g, '');
  if (/^\d+\.?\d*[eE][+-]?\d+$/.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n) && n >= 1e14 && n < 1e16) return String(Math.round(n));
  }
  return t;
}

function normalizeImei(raw: string): string {
  return expandExcelNumber(raw).replace(/\D/g, '');
}

function normalizeProtocol(raw: string): DeviceProtocol | null {
  const t = raw
    .trim()
    .toLowerCase()
    .replace(/[\s/_-]+/g, '');
  if (t === 'gt06' || t === 'gt06n') return 'gt06';
  if (t === 'jt808' || t === 'jtt808' || t === 'jt808') return 'jt808';
  if (t === 'meitrack' || t === 'mei' || t === 'mdvr') return 'meitrack';
  if (t === 'stub') return 'stub';
  return PROTOCOLS.has(t as DeviceProtocol) ? (t as DeviceProtocol) : null;
}

function cell(row: string[], idx: number | undefined): string {
  if (idx === undefined) return '';
  return (row[idx] ?? '').trim();
}

function optional(value: string): string | undefined {
  const t = sanitizeSpreadsheetText(value);
  return t === '' ? undefined : t;
}

const INVISIBLE = /[\u200B\u200C\uFEFF\u2060\u00A0\u200E\u200F\u202A-\u202E]|\u200D/g;
const DASHES = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;

function sanitizeSpreadsheetText(raw: string): string {
  return raw.normalize('NFKC').replace(INVISIBLE, '').replace(DASHES, '-').trim();
}

function mapHeaders<K extends string>(
  headerRow: string[],
  aliases: Record<string, K>,
): Partial<Record<K, number>> {
  const map: Partial<Record<K, number>> = {};
  headerRow.forEach((h, i) => {
    const key = aliases[normalizeHeader(h)];
    if (key && map[key] === undefined) map[key] = i;
  });
  return map;
}

const CODE_RE = /^[A-Za-z0-9_-]+$/;
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;
const ODOMETER_KM_MAX = 10_000_000;
const ENGINE_HOURS_MAX = 1_000_000;
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function parseNonNegNumber(raw: string, max: number): { value?: number; invalid: boolean } {
  const t = sanitizeSpreadsheetText(raw)
    .replace(/[۰-۹]/g, (ch) => String(FA_DIGITS.indexOf(ch)))
    .replace(/[٠-٩]/g, (ch) => String(AR_DIGITS.indexOf(ch)))
    .replace(/[,_\s]/g, '');
  if (t === '') return { invalid: false };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > max) return { invalid: true };
  return { value: n, invalid: false };
}

export function parseVehicleGrid(grid: string[][]): ParsedAssetImport<VehicleImportDraft> {
  const table = trimGrid(grid);
  if (table.length < 2) {
    return { kind: 'vehicles', rows: [], issues: [{ row: 1, code: 'emptyFile' }] };
  }
  const cols = mapHeaders(table[0] ?? [], VEHICLE_ALIASES);
  if (cols.name === undefined || cols.code === undefined || cols.fleetCode === undefined) {
    return { kind: 'vehicles', rows: [], issues: [{ row: 1, code: 'badHeaders' }] };
  }
  const rows: VehicleImportDraft[] = [];
  const issues: ImportRowIssue[] = [];
  const data = table.slice(1);
  if (data.length > ASSET_IMPORT_MAX_ROWS) {
    issues.push({ row: 1, code: 'maxRows' });
    return { kind: 'vehicles', rows, issues };
  }
  data.forEach((raw, i) => {
    const row = i + 2;
    if (raw.every((c) => c.trim() === '')) return;
    const name = cell(raw, cols.name);
    const code = sanitizeSpreadsheetText(cell(raw, cols.code));
    const fleetCode = sanitizeSpreadsheetText(cell(raw, cols.fleetCode));
    const plate = optional(cell(raw, cols.plate));
    const vin = optional(cell(raw, cols.vin))?.toUpperCase();
    const odo = parseNonNegNumber(cell(raw, cols.odometerKm), ODOMETER_KM_MAX);
    const hours = parseNonNegNumber(cell(raw, cols.engineHours), ENGINE_HOURS_MAX);
    if (!name) issues.push({ row, field: 'name', code: 'missingName' });
    if (!code) issues.push({ row, field: 'code', code: 'missingCode' });
    else if (!CODE_RE.test(code)) issues.push({ row, field: 'code', code: 'invalidCode' });
    if (!fleetCode) issues.push({ row, field: 'fleetCode', code: 'missingFleetCode' });
    if (vin && !VIN_RE.test(vin)) issues.push({ row, field: 'vin', code: 'invalidVin' });
    if (odo.invalid) issues.push({ row, field: 'odometerKm', code: 'invalidOdometer' });
    if (hours.invalid) issues.push({ row, field: 'engineHours', code: 'invalidEngineHours' });
    rows.push({
      row,
      name,
      code,
      fleetCode,
      plate,
      vin,
      odometerKm: odo.value,
      engineHours: hours.value,
    });
  });
  if (rows.length === 0 && issues.length === 0) issues.push({ row: 1, code: 'emptyFile' });
  return { kind: 'vehicles', rows, issues };
}

export function parseDeviceGrid(grid: string[][]): ParsedAssetImport<DeviceImportDraft> {
  const table = trimGrid(grid);
  if (table.length < 2) {
    return { kind: 'devices', rows: [], issues: [{ row: 1, code: 'emptyFile' }] };
  }
  const cols = mapHeaders(table[0] ?? [], DEVICE_ALIASES);
  if (cols.imei === undefined || cols.protocol === undefined) {
    return { kind: 'devices', rows: [], issues: [{ row: 1, code: 'badHeaders' }] };
  }
  const rows: DeviceImportDraft[] = [];
  const issues: ImportRowIssue[] = [];
  const data = table.slice(1);
  if (data.length > ASSET_IMPORT_MAX_ROWS) {
    issues.push({ row: 1, code: 'maxRows' });
    return { kind: 'devices', rows, issues };
  }
  data.forEach((raw, i) => {
    const row = i + 2;
    if (raw.every((c) => c.trim() === '')) return;
    const imei = normalizeImei(cell(raw, cols.imei));
    const protocol = normalizeProtocol(cell(raw, cols.protocol));
    const serialNumber = optional(cell(raw, cols.serialNumber));
    const manufacturer = optional(cell(raw, cols.manufacturer));
    const model = optional(cell(raw, cols.model));
    const vehicleCode = optional(cell(raw, cols.vehicleCode));
    if (!/^\d{15}$/.test(imei)) issues.push({ row, field: 'imei', code: 'invalidImei' });
    else if (!luhnValid(imei)) issues.push({ row, field: 'imei', code: 'imeiLuhn' });
    if (!protocol) issues.push({ row, field: 'protocol', code: 'invalidProtocol' });
    rows.push({
      row,
      imei,
      protocol: protocol ?? 'gt06',
      serialNumber,
      manufacturer,
      model,
      vehicleCode,
    });
  });
  if (rows.length === 0 && issues.length === 0) issues.push({ row: 1, code: 'emptyFile' });
  return { kind: 'devices', rows, issues };
}

export async function parseAssetImportFile(
  file: File,
  kind: AssetImportKind,
): Promise<ParsedAssetImport<VehicleImportDraft> | ParsedAssetImport<DeviceImportDraft>> {
  const grid = await parseTabularFile(file);
  return kind === 'vehicles' ? parseVehicleGrid(grid) : parseDeviceGrid(grid);
}

const VEHICLE_TEMPLATE: string[][] = [
  ['name', 'code', 'fleetCode', 'plate', 'vin', 'odometerKm', 'engineHours'],
  ['Truck One', 'V001', 'NORTH', '12A345-67', 'WP0ZZZ99ZTS392124', '48210', '12500'],
];

const DEVICE_TEMPLATE: string[][] = [
  ['imei', 'protocol', 'serialNumber', 'manufacturer', 'model', 'vehicleCode'],
  ['490154203237518', 'gt06', 'SN-1001', 'Teltonika', 'FMB920', 'V001'],
];

export function buildAssetImportTemplate(kind: AssetImportKind): { blob: Blob; filename: string } {
  const rows = kind === 'vehicles' ? VEHICLE_TEMPLATE : DEVICE_TEMPLATE;
  const bytes = buildXlsx(kind === 'vehicles' ? 'Vehicles' : 'Devices', rows);
  // Copy into a fresh ArrayBuffer so BlobPart is a definite ArrayBuffer, not ArrayBufferLike.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return {
    blob: new Blob([copy.buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename: kind === 'vehicles' ? 'vehicles-import.xlsx' : 'devices-import.xlsx',
  };
}

export { SpreadsheetParseError };
