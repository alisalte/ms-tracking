/**
 * Map a spreadsheet grid onto vehicle / device / driver import rows.
 *
 * Headers accept English and Persian aliases. IMEI is stripped of separators
 * and expanded from Excel scientific notation when it still looks like 15 digits.
 */
import { SpreadsheetParseError, parseTabularFile, trimGrid, xlsxBlob } from '@/lib/spreadsheet';
import type { DeviceProtocol } from '@/types/asset.types';

export const ASSET_IMPORT_MAX_ROWS = 500;

export type AssetImportKind = 'vehicles' | 'devices' | 'drivers';

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

export interface DriverImportDraft {
  row: number;
  firstName: string;
  lastName: string;
  licenseNumber: string;
  employeeId?: string;
  email?: string;
  phone?: string;
  licenseClass?: string;
  /** Calendar date `YYYY-MM-DD` (converted to ISO datetime on submit). */
  licenseIssued?: string;
  licenseExpires?: string;
  licenseCountry?: string;
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
  return h
    .trim()
    .toLowerCase()
    .replace(/[\u200c\u200d]/g, '')
    .replace(/\s+/g, '')
    .replace(/[_-]+/g, '');
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

const DRIVER_ALIASES: Record<string, keyof Omit<DriverImportDraft, 'row'>> = {
  firstname: 'firstName',
  نام: 'firstName',
  نامکوچک: 'firstName',
  lastname: 'lastName',
  نامخانوادگی: 'lastName',
  فامیل: 'lastName',
  licensenumber: 'licenseNumber',
  license: 'licenseNumber',
  گواهینامه: 'licenseNumber',
  شمارهگواهینامه: 'licenseNumber',
  employeeid: 'employeeId',
  شمارهپرسنلی: 'employeeId',
  پرسنلی: 'employeeId',
  کدپرسنلی: 'employeeId',
  email: 'email',
  ایمیل: 'email',
  phone: 'phone',
  تلفن: 'phone',
  موبایل: 'phone',
  شمارهتماس: 'phone',
  licenseclass: 'licenseClass',
  کلاسگواهینامه: 'licenseClass',
  licenseissued: 'licenseIssued',
  تاریخصدور: 'licenseIssued',
  licenseexpires: 'licenseExpires',
  تاریخانقضا: 'licenseExpires',
  انقضا: 'licenseExpires',
  licensecountry: 'licenseCountry',
  کشورگواهینامه: 'licenseCountry',
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
const VIN_RE = /^[A-HJ-NPR-Z0-9]{1,17}$/i;
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asciiDigits(raw: string): string {
  return sanitizeSpreadsheetText(raw)
    .replace(/[۰-۹]/g, (ch) => String(FA_DIGITS.indexOf(ch)))
    .replace(/[٠-٩]/g, (ch) => String(AR_DIGITS.indexOf(ch)));
}

function isValidYmd(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** `YYYY-MM-DD`, Excel serial (e.g. 44927), or day/month/year. */
export function parseSpreadsheetDate(raw: string): { value?: string; invalid: boolean } {
  const t = asciiDigits(raw);
  if (t === '') return { invalid: false };
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const iso = t.slice(0, 10);
    return isValidYmd(iso) ? { value: iso, invalid: false } : { invalid: true };
  }
  const ymd = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(t);
  if (ymd) {
    const iso = `${ymd[1]}-${(ymd[2] ?? '').padStart(2, '0')}-${(ymd[3] ?? '').padStart(2, '0')}`;
    return isValidYmd(iso) ? { value: iso, invalid: false } : { invalid: true };
  }
  if (/^\d{4,6}(\.\d+)?$/.test(t)) {
    const n = Number(t);
    if (n >= 20000 && n < 80000) {
      const utc = Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000;
      const d = new Date(utc);
      if (!Number.isNaN(d.getTime()))
        return { value: d.toISOString().slice(0, 10), invalid: false };
    }
  }
  const dmy = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(t);
  if (dmy) {
    const a = Number(dmy[1]);
    const b = Number(dmy[2]);
    const y = Number(dmy[3]);
    const day = a > 12 ? a : b;
    const month = a > 12 ? b : a;
    const iso = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return isValidYmd(iso) ? { value: iso, invalid: false } : { invalid: true };
  }
  return { invalid: true };
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

export function parseDriverGrid(grid: string[][]): ParsedAssetImport<DriverImportDraft> {
  const table = trimGrid(grid);
  if (table.length < 2) {
    return { kind: 'drivers', rows: [], issues: [{ row: 1, code: 'emptyFile' }] };
  }
  const cols = mapHeaders(table[0] ?? [], DRIVER_ALIASES);
  if (
    cols.firstName === undefined ||
    cols.lastName === undefined ||
    cols.licenseNumber === undefined
  ) {
    return { kind: 'drivers', rows: [], issues: [{ row: 1, code: 'badHeaders' }] };
  }
  const rows: DriverImportDraft[] = [];
  const issues: ImportRowIssue[] = [];
  const data = table.slice(1);
  if (data.length > ASSET_IMPORT_MAX_ROWS) {
    issues.push({ row: 1, code: 'maxRows' });
    return { kind: 'drivers', rows, issues };
  }
  data.forEach((raw, i) => {
    const row = i + 2;
    if (raw.every((c) => c.trim() === '')) return;
    const firstName = sanitizeSpreadsheetText(cell(raw, cols.firstName));
    const lastName = sanitizeSpreadsheetText(cell(raw, cols.lastName));
    const licenseNumber = sanitizeSpreadsheetText(cell(raw, cols.licenseNumber));
    const employeeId = optional(cell(raw, cols.employeeId));
    const email = optional(cell(raw, cols.email));
    const phone = optional(cell(raw, cols.phone));
    const licenseClass = optional(cell(raw, cols.licenseClass));
    const issued = parseSpreadsheetDate(cell(raw, cols.licenseIssued));
    const expires = parseSpreadsheetDate(cell(raw, cols.licenseExpires));
    const licenseCountry = optional(cell(raw, cols.licenseCountry));
    const vehicleCode = optional(cell(raw, cols.vehicleCode));
    if (!firstName) issues.push({ row, field: 'firstName', code: 'missingFirstName' });
    if (!lastName) issues.push({ row, field: 'lastName', code: 'missingLastName' });
    if (!licenseNumber) issues.push({ row, field: 'licenseNumber', code: 'missingLicenseNumber' });
    if (email && !EMAIL_RE.test(email)) issues.push({ row, field: 'email', code: 'invalidEmail' });
    if (issued.invalid) issues.push({ row, field: 'licenseIssued', code: 'invalidDate' });
    if (expires.invalid) issues.push({ row, field: 'licenseExpires', code: 'invalidDate' });
    rows.push({
      row,
      firstName,
      lastName,
      licenseNumber,
      employeeId,
      email,
      phone,
      licenseClass,
      licenseIssued: issued.value,
      licenseExpires: expires.value,
      licenseCountry,
      vehicleCode,
    });
  });
  if (rows.length === 0 && issues.length === 0) issues.push({ row: 1, code: 'emptyFile' });
  return { kind: 'drivers', rows, issues };
}

export type ParsedAnyAssetImport =
  | ParsedAssetImport<VehicleImportDraft>
  | ParsedAssetImport<DeviceImportDraft>
  | ParsedAssetImport<DriverImportDraft>;

export async function parseAssetImportFile(
  file: File,
  kind: AssetImportKind,
): Promise<ParsedAnyAssetImport> {
  const grid = await parseTabularFile(file);
  if (kind === 'vehicles') return parseVehicleGrid(grid);
  if (kind === 'devices') return parseDeviceGrid(grid);
  return parseDriverGrid(grid);
}

const VEHICLE_TEMPLATE: string[][] = [
  ['name', 'code', 'fleetCode', 'plate', 'vin', 'odometerKm', 'engineHours'],
  ['Truck One', 'V001', 'NORTH', '12A345-67', 'WP0ZZZ99ZTS392124', '48210', '12500'],
];

const DEVICE_TEMPLATE: string[][] = [
  ['imei', 'protocol', 'serialNumber', 'manufacturer', 'model', 'vehicleCode'],
  ['490154203237518', 'gt06', 'SN-1001', 'Teltonika', 'FMB920', 'V001'],
];

const DRIVER_TEMPLATE: string[][] = [
  [
    'firstName',
    'lastName',
    'licenseNumber',
    'employeeId',
    'email',
    'phone',
    'licenseClass',
    'licenseIssued',
    'licenseExpires',
    'licenseCountry',
    'vehicleCode',
  ],
  [
    'Ali',
    'Karimi',
    'DL-1001',
    'EMP-001',
    'ali.karimi@fleet.local',
    '+989121111111',
    'B',
    '2020-01-15',
    '2028-01-15',
    'IR',
    'V001',
  ],
];

const TEMPLATE_META: Record<
  AssetImportKind,
  { sheet: string; filename: string; rows: string[][] }
> = {
  vehicles: { sheet: 'Vehicles', filename: 'vehicles-import.xlsx', rows: VEHICLE_TEMPLATE },
  devices: { sheet: 'Devices', filename: 'devices-import.xlsx', rows: DEVICE_TEMPLATE },
  drivers: { sheet: 'Drivers', filename: 'drivers-import.xlsx', rows: DRIVER_TEMPLATE },
};

export function buildAssetImportTemplate(kind: AssetImportKind): { blob: Blob; filename: string } {
  const meta = TEMPLATE_META[kind];
  return { blob: xlsxBlob(meta.sheet, meta.rows), filename: meta.filename };
}

export { SpreadsheetParseError };
