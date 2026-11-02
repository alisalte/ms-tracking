/**
 * The driver / truck shift report as Excel sheets (Persian or English):
 *   1. services of each driver over the range
 *   2. daily services of each truck, one column per shift (day / night)
 *   3. daily working hours of each truck, one column per shift
 *   4. each driver's hours, distance and services per day
 *   5. the same per month
 *   6. the trucks each driver worked on per month
 * Hours are decimal hours and distance kilometres, so Excel can sum them.
 */
import type { CsvLocale } from './csv-locale.js';
import type { ShiftInfo } from './haul-shifts.js';
import type { SheetCell, SheetSpec } from './xlsx.js';

interface DriverRow {
  readonly driverId: string;
  readonly driverName: string;
  readonly services: number;
  readonly serviceDistanceKm: number;
  readonly workSec: number;
  readonly movingSec: number;
  readonly distanceKm: number;
  readonly days: number;
  readonly shifts: number;
  readonly vehicleNames: string[];
  readonly servicesByShift: Record<number, number>;
}

interface DriverPeriod extends DriverRow {
  readonly period: string;
  readonly from: string;
  readonly to: string;
}

export interface HaulShiftReport {
  readonly routes: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly from: string;
  readonly to: string;
  readonly calendar: 'jalali' | 'gregorian';
  readonly truncated: boolean;
  readonly shifts: ShiftInfo[];
  readonly services: number;
  readonly workSec: number;
  readonly distanceKm: number;
  readonly trucks: Array<{
    readonly day: string;
    readonly vehicleId: string;
    readonly vehicleName: string;
    readonly shiftNo: number;
    readonly services: number;
    readonly serviceDistanceKm: number;
    readonly workSec: number;
    readonly movingSec: number;
    readonly distanceKm: number;
    readonly driverNames: string[];
  }>;
  readonly drivers: DriverRow[];
  readonly driverDays: DriverPeriod[];
  readonly driverMonths: DriverPeriod[];
}

const LABELS = {
  fa: {
    sheetDrivers: 'آمار سرویس رانندگان',
    sheetTruckServices: 'سرویس روزانه تراک',
    sheetTruckHours: 'ساعت کارکرد تراک',
    sheetDriverDays: 'کارکرد روزانه راننده',
    sheetDriverMonths: 'کارکرد ماهانه راننده',
    sheetDriverTrucks: 'تراک‌های راننده در ماه',
    date: 'تاریخ',
    month: 'ماه',
    truck: 'تراک',
    driver: 'راننده',
    drivers: 'رانندگان',
    services: 'تعداد سرویس',
    servicesIn: (shift: string) => `سرویس ${shift}`,
    hoursIn: (shift: string) => `ساعت کارکرد ${shift}`,
    totalServices: 'جمع سرویس',
    totalHours: 'جمع ساعت کارکرد',
    workHours: 'ساعت کارکرد',
    movingHours: 'ساعت حرکت',
    distanceKm: 'کیلومتر پیمایش',
    serviceKm: 'کیلومتر سرویس',
    shiftsWorked: 'تعداد شیفت',
    daysWorked: 'روزهای کاری',
    servicesPerShift: 'میانگین سرویس در شیفت',
    trucks: 'تراک‌ها',
    truckCount: 'تعداد تراک',
    day: 'شیفت روز',
    night: 'شیفت شب',
    shiftN: (n: number) => `شیفت ${n}`,
    offShift: 'خارج از شیفت',
  },
  en: {
    sheetDrivers: 'Driver services',
    sheetTruckServices: 'Truck daily services',
    sheetTruckHours: 'Truck working hours',
    sheetDriverDays: 'Driver daily work',
    sheetDriverMonths: 'Driver monthly work',
    sheetDriverTrucks: 'Driver trucks per month',
    date: 'Date',
    month: 'Month',
    truck: 'Truck',
    driver: 'Driver',
    drivers: 'Drivers',
    services: 'Services',
    servicesIn: (shift: string) => `Services · ${shift}`,
    hoursIn: (shift: string) => `Working hours · ${shift}`,
    totalServices: 'Total services',
    totalHours: 'Total working hours',
    workHours: 'Working hours',
    movingHours: 'Moving hours',
    distanceKm: 'Distance (km)',
    serviceKm: 'Service distance (km)',
    shiftsWorked: 'Shifts',
    daysWorked: 'Work days',
    servicesPerShift: 'Services per shift',
    trucks: 'Trucks',
    truckCount: 'Truck count',
    day: 'day shift',
    night: 'night shift',
    shiftN: (n: number) => `shift ${n}`,
    offShift: 'off-shift',
  },
} as const;

type Labels = (typeof LABELS)[CsvLocale];

/** Day / night when the plan is one of each; else the route (and its shift) when several are combined. */
function shiftName(no: number, report: HaulShiftReport, l: Labels): string {
  if (no === 0) return l.offShift;
  const info = report.shifts.find((s) => s.no === no);
  if (info?.kind === 'day') return l.day;
  if (info?.kind === 'night') return l.night;
  if (info && report.routes.length > 1) {
    return info.routeShiftCount > 1
      ? `${info.routeName} · ${l.shiftN(info.routeShiftNo)}`
      : info.routeName;
  }
  return l.shiftN(no);
}

const hours = (sec: number) => Math.round((sec / 3600) * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** `2026-11-02` → `1405/08/11` (Jalali) or the date itself. */
function dayLabel(day: string, locale: CsvLocale): string {
  const at = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return day;
  if (locale === 'en') return day;
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}/${pick('month')}/${pick('day')}`;
}

function monthLabel(
  row: { period: string; from: string },
  report: HaulShiftReport,
  locale: CsvLocale,
) {
  if (report.calendar === 'gregorian') return row.period;
  const at = new Date(`${row.from}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return row.period;
  const parts = new Intl.DateTimeFormat(
    locale === 'fa' ? 'fa-IR-u-ca-persian-nu-latn' : 'en-US-u-ca-persian',
    { timeZone: 'UTC', year: 'numeric', month: 'long' },
  ).formatToParts(at);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // Month then year («مهر 1405», "Mehr 1405") whatever order the ICU build prefers.
  return `${pick('month')} ${pick('year')}`;
}

/** Shift numbers that appear in the data, in order; route shifts first. */
function shiftColumns(report: HaulShiftReport): number[] {
  const seen = new Set<number>(report.shifts.map((s) => s.no));
  for (const row of report.trucks) seen.add(row.shiftNo);
  return [...seen].sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b));
}

/** Truck rows of one day pivoted to one column per shift. */
function truckPivot(
  report: HaulShiftReport,
  shifts: number[],
  value: (row: HaulShiftReport['trucks'][number]) => number,
): Array<{ day: string; vehicleName: string; values: number[]; drivers: Set<string>; km: number }> {
  const out = new Map<
    string,
    { day: string; vehicleName: string; values: number[]; drivers: Set<string>; km: number }
  >();
  for (const row of report.trucks) {
    const key = `${row.day}|${row.vehicleId}`;
    let acc = out.get(key);
    if (!acc) {
      acc = {
        day: row.day,
        vehicleName: row.vehicleName,
        values: shifts.map(() => 0),
        drivers: new Set(),
        km: 0,
      };
      out.set(key, acc);
    }
    const i = shifts.indexOf(row.shiftNo);
    if (i >= 0) acc.values[i] = (acc.values[i] ?? 0) + value(row);
    for (const name of row.driverNames) acc.drivers.add(name);
    acc.km += row.distanceKm;
  }
  return [...out.values()];
}

export function haulShiftSheets(report: HaulShiftReport, locale: CsvLocale = 'fa'): SheetSpec[] {
  const l: Labels = LABELS[locale];
  const rtl = locale === 'fa';
  const shifts = shiftColumns(report);
  const names = shifts.map((no) => shiftName(no, report, l));
  const list = (items: readonly string[]) => items.join(locale === 'fa' ? '، ' : ', ');

  const drivers: SheetCell[][] = [
    [
      l.driver,
      l.services,
      ...names.map(l.servicesIn),
      l.shiftsWorked,
      l.servicesPerShift,
      l.serviceKm,
      l.distanceKm,
      l.workHours,
      l.movingHours,
      l.trucks,
    ],
    ...report.drivers.map((row) => [
      row.driverName,
      row.services,
      ...shifts.map((no) => row.servicesByShift[no] ?? 0),
      row.shifts,
      row.shifts > 0 ? round1(row.services / row.shifts) : 0,
      round1(row.serviceDistanceKm),
      round1(row.distanceKm),
      hours(row.workSec),
      hours(row.movingSec),
      list(row.vehicleNames),
    ]),
  ];

  const servicePivot = truckPivot(report, shifts, (row) => row.services);
  const truckServices: SheetCell[][] = [
    [l.date, l.truck, ...names.map(l.servicesIn), l.totalServices, l.drivers],
    ...servicePivot.map((row) => [
      dayLabel(row.day, locale),
      row.vehicleName,
      ...row.values,
      row.values.reduce((a, b) => a + b, 0),
      list([...row.drivers]),
    ]),
  ];

  const hourPivot = truckPivot(report, shifts, (row) => row.workSec);
  const truckHours: SheetCell[][] = [
    [l.date, l.truck, ...names.map(l.hoursIn), l.totalHours, l.distanceKm],
    ...hourPivot.map((row) => [
      dayLabel(row.day, locale),
      row.vehicleName,
      ...row.values.map(hours),
      hours(row.values.reduce((a, b) => a + b, 0)),
      round1(row.km),
    ]),
  ];

  const driverDays: SheetCell[][] = [
    [l.date, l.driver, l.workHours, l.distanceKm, l.services, l.trucks],
    ...report.driverDays.map((row) => [
      dayLabel(row.period, locale),
      row.driverName,
      hours(row.workSec),
      round1(row.distanceKm),
      row.services,
      list(row.vehicleNames),
    ]),
  ];

  const driverMonths: SheetCell[][] = [
    [l.month, l.driver, l.workHours, l.distanceKm, l.services, l.daysWorked, l.shiftsWorked],
    ...report.driverMonths.map((row) => [
      monthLabel(row, report, locale),
      row.driverName,
      hours(row.workSec),
      round1(row.distanceKm),
      row.services,
      row.days,
      row.shifts,
    ]),
  ];

  const driverTrucks: SheetCell[][] = [
    [l.month, l.driver, l.truckCount, l.trucks],
    ...report.driverMonths.map((row) => [
      monthLabel(row, report, locale),
      row.driverName,
      row.vehicleNames.length,
      list(row.vehicleNames),
    ]),
  ];

  return [
    { name: l.sheetDrivers, rows: drivers, rtl },
    { name: l.sheetTruckServices, rows: truckServices, rtl },
    { name: l.sheetTruckHours, rows: truckHours, rtl },
    { name: l.sheetDriverDays, rows: driverDays, rtl },
    { name: l.sheetDriverMonths, rows: driverMonths, rtl },
    { name: l.sheetDriverTrucks, rows: driverTrucks, rtl },
  ];
}
