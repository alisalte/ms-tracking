/**
 * Report columns that keep the calendar date and the time of day apart, so a
 * start or an end can be read, sorted and copied to a sheet in two cells.
 * The date follows the UI calendar (Shamsi in Persian).
 */
import type { Column } from '@/components/reports/ReportsTable';
import { formatClock, formatDateNumeric } from '@/lib/format-date';

type Stamp = string | null | undefined;

export function dateTimeColumns<Row>(
  id: string,
  headerKeys: { date: string; time: string },
  stamp: (row: Row) => Stamp,
  lang?: string,
): Array<Column<Row>> {
  return [
    {
      id: `${id}-date`,
      headerKey: headerKeys.date,
      render: (row) => {
        const value = stamp(row);
        return value ? formatDateNumeric(value, lang) : '—';
      },
    },
    {
      id: `${id}-time`,
      headerKey: headerKeys.time,
      render: (row) => {
        const value = stamp(row);
        return value ? formatClock(value, lang) : '—';
      },
    },
  ];
}

/** Start date, start time, end date and end time for a row with both bounds. */
export function startEndColumns<Row>(
  start: (row: Row) => Stamp,
  end: (row: Row) => Stamp,
  lang?: string,
): Array<Column<Row>> {
  return [
    ...dateTimeColumns(
      'start',
      { date: 'reports.cols.startDate', time: 'reports.cols.startTime' },
      start,
      lang,
    ),
    ...dateTimeColumns(
      'end',
      { date: 'reports.cols.endDate', time: 'reports.cols.endTime' },
      end,
      lang,
    ),
  ];
}
