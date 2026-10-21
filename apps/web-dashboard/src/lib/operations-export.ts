/**
 * Excel export for the operations (کارکرد) page.
 *
 * Every report becomes a multi-sheet .xlsx whose numbers stay numbers, so the
 * operator can sum, sort and pivot them in Excel. Hours are exported as
 * decimal hours, distance in kilometres.
 */
import type { TFunction } from 'i18next';

import type {
  DeviceActivityReport,
  HaulCycleReport,
  HaulPeriodReport,
  PeriodCalendar,
  PeriodGranularity,
} from '@/api/operations.api';
import { type SheetCell, type SheetSpec, xlsxWorkbookBlob } from '@/lib/spreadsheet';
import { downloadBlob } from '@/lib/video-stream';

export function hoursOf(sec: number | null | undefined): number | null {
  if (sec === null || sec === undefined) return null;
  return Math.round((sec / 3600) * 100) / 100;
}

function dateTime(value: string | null, lang: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-GB');
}

/** A work-day date (`YYYY-MM-DD`) in the UI language's calendar. */
export function formatWorkDay(date: string, lang: string): string {
  const day = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(day.getTime())) return date;
  return day.toLocaleDateString(lang === 'fa' ? 'fa-IR' : 'en-GB', { timeZone: 'UTC' });
}

/** Human label of a roll-up period. */
export function periodLabel(
  row: { key: string; from: string; to: string },
  granularity: PeriodGranularity,
  calendar: PeriodCalendar,
  lang: string,
): string {
  if (granularity === 'daily') return formatWorkDay(row.from, lang);
  if (granularity === 'weekly') {
    return `${formatWorkDay(row.from, lang)} – ${formatWorkDay(row.to, lang)}`;
  }
  // Month name from the middle of the period, so the edge days of a Jalali
  // month never land in the neighbouring Gregorian month label.
  const mid = new Date(`${row.from}T12:00:00Z`);
  mid.setUTCDate(mid.getUTCDate() + 10);
  const locale = `${lang === 'fa' ? 'fa-IR' : 'en-US'}-u-ca-${calendar === 'jalali' ? 'persian' : 'gregory'}`;
  return mid.toLocaleDateString(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' });
}

function shiftText(
  row: { shift: string; shiftDate: string | null; shiftNo: number },
  t: TFunction,
  lang: string,
): string {
  if (row.shift === 'off-shift' || !row.shiftDate) return t('operations.offShift');
  return `${formatWorkDay(row.shiftDate, lang)} · ${t('operations.shiftN', { n: row.shiftNo })}`;
}

export function activitySheets(
  report: DeviceActivityReport,
  t: TFunction,
  lang: string,
): SheetSpec[] {
  const rtl = lang === 'fa';
  return [
    {
      name: t('operations.sheetActivity'),
      rtl,
      rows: [
        [
          t('operations.colImei'),
          t('operations.colVehicle'),
          t('operations.colStarted'),
          t('operations.colFixes'),
          t('operations.colOffline'),
          t('operations.colDistance'),
          t('operations.colSilent'),
        ],
        ...report.devices.map((row): SheetCell[] => [
          row.imei,
          row.vehicleName ?? t('operations.unbound'),
          dateTime(row.startedAt, lang),
          row.fixes,
          hoursOf(row.offlineSec),
          row.distanceKm,
          row.silent ? t('operations.silentYes') : t('operations.silentNo'),
        ]),
      ],
    },
  ];
}

export function haulSheets(report: HaulCycleReport, t: TFunction, lang: string): SheetSpec[] {
  const rtl = lang === 'fa';
  return [
    {
      name: t('operations.sheetSummary'),
      rtl,
      rows: [
        [t('operations.routeName'), report.route.name],
        [t('operations.range'), `${dateTime(report.from, lang)} → ${dateTime(report.to, lang)}`],
        [t('operations.services'), report.services],
        [t('operations.colDistance'), report.distanceKm],
      ],
    },
    {
      name: t('operations.sheetByShift'),
      rtl,
      rows: [
        [
          t('operations.colShift'),
          t('operations.services'),
          t('operations.colDistance'),
          t('operations.colLoad'),
          t('operations.colHours'),
          t('operations.colTrucks'),
          t('operations.colDrivers'),
          t('operations.colWithoutDriver'),
        ],
        ...report.byShift.map((row): SheetCell[] => [
          shiftText(row, t, lang),
          row.services,
          row.distanceKm,
          hoursOf(row.loadDwellSec),
          hoursOf(row.durationSec),
          row.trucks,
          row.drivers,
          row.withoutDriver,
        ]),
      ],
    },
    {
      name: t('operations.sheetByVehicle'),
      rtl,
      rows: [
        [
          t('operations.colVehicle'),
          t('operations.services'),
          t('operations.colDistance'),
          t('operations.colHours'),
        ],
        ...report.byVehicle.map((row): SheetCell[] => [
          row.vehicleName,
          row.services,
          row.distanceKm,
          hoursOf(row.durationSec),
        ]),
      ],
    },
    {
      name: t('operations.sheetByDriver'),
      rtl,
      rows: [
        [
          t('operations.colDriver'),
          t('operations.colShift'),
          t('operations.colVehicles'),
          t('operations.services'),
          t('operations.colDistance'),
          t('operations.colHours'),
        ],
        ...report.byDriverShift.map((row): SheetCell[] => [
          row.driverName,
          shiftText(row, t, lang),
          (row.vehicleNames ?? []).join('، '),
          row.services,
          row.distanceKm,
          hoursOf(row.durationSec),
        ]),
      ],
    },
    {
      name: t('operations.sheetByShovel'),
      rtl,
      rows: [
        [t('operations.colShovel'), t('operations.loads')],
        ...report.byShovel.map((row): SheetCell[] => [row.shovelLabel, row.loads]),
      ],
    },
    {
      name: t('operations.sheetCycles'),
      rtl,
      rows: [
        [
          t('operations.colTime'),
          t('operations.colVehicle'),
          t('operations.colDriver'),
          t('operations.colShovel'),
          t('operations.colShift'),
          t('operations.colLoad'),
          t('operations.colTravel'),
          t('operations.colDistance'),
        ],
        ...report.cycles.map((row): SheetCell[] => [
          dateTime(row.originEnteredAt, lang),
          row.vehicleName,
          row.driverName ?? '',
          row.shovelLabel ?? '',
          shiftText(row, t, lang),
          hoursOf(row.loadDwellSec),
          hoursOf(row.travelSec),
          row.distanceKm,
        ]),
      ],
    },
  ];
}

export function periodSheets(report: HaulPeriodReport, t: TFunction, lang: string): SheetSpec[] {
  const rtl = lang === 'fa';
  const labels = new Map(
    report.periods.map((row) => [
      row.key,
      periodLabel(row, report.granularity, report.calendar, lang),
    ]),
  );
  return [
    {
      name: t('operations.sheetPeriods'),
      rtl,
      rows: [
        [
          t('operations.colPeriod'),
          t('operations.colServices'),
          t('operations.colDistance'),
          t('operations.colLoad'),
          t('operations.colHours'),
          t('operations.colTrucks'),
          t('operations.colDrivers'),
          t('operations.colWithoutDriver'),
        ],
        ...report.periods.map((row): SheetCell[] => [
          labels.get(row.key) ?? row.key,
          row.services,
          row.distanceKm,
          hoursOf(row.loadDwellSec),
          hoursOf(row.durationSec),
          row.trucks,
          row.drivers,
          row.withoutDriver,
        ]),
        [
          t('operations.colPeriodTotal'),
          report.services,
          report.distanceKm,
          hoursOf(report.periods.reduce((sum, row) => sum + row.loadDwellSec, 0)),
          hoursOf(report.periods.reduce((sum, row) => sum + row.durationSec, 0)),
        ],
      ],
    },
    {
      name: t('operations.sheetPeriodDetails'),
      rtl,
      rows: [
        [
          t('operations.colPeriod'),
          t('operations.colVehicle'),
          t('operations.colShift'),
          t('operations.colDriver'),
          t('operations.colServices'),
          t('operations.colDistance'),
          t('operations.colLoad'),
          t('operations.colHours'),
        ],
        ...report.details.map((row): SheetCell[] => [
          labels.get(row.period) ?? row.period,
          row.vehicleName,
          row.shiftNo > 0 ? t('operations.shiftN', { n: row.shiftNo }) : t('operations.offShift'),
          row.driverName ?? '',
          row.services,
          row.distanceKm,
          hoursOf(row.loadDwellSec),
          hoursOf(row.durationSec),
        ]),
      ],
    },
  ];
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Build the workbook and hand it to the browser as a download. */
export function downloadWorkbook(sheets: SheetSpec[], baseName: string): void {
  const name = baseName.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'operations';
  downloadBlob(xlsxWorkbookBlob(sheets), `${name}-${stamp()}.xlsx`);
}
