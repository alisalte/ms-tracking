/**
 * Shared building blocks of the operations (`/operations`) tabs: a titled
 * panel, a chart card with an empty state, a report table that can carry a
 * test id, and number helpers that follow the UI language.
 */
import type { ApexOptions } from 'apexcharts';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ApexChart, type ApexChartType } from '@/components/dashboard/ApexChart';
import { type Column, ReportsTable } from '@/components/reports/ReportsTable';
import { Card, CardHeader } from '@/components/tailwind-ui';
import { formatNumber } from '@/lib/format-number';
import { chart } from '@/theme/palette';

/** A titled card; `hint` is the plain-language note under the title. */
export function Panel({
  title,
  hint,
  action,
  children,
  testId,
  className = '',
}: {
  title?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <Card className={className} data-testid={testId}>
      {title && <CardHeader title={title} action={action} className={hint ? 'mb-1' : ''} />}
      {hint && (
        <p className="mb-4 text-sm leading-6 text-gray-500 dark:text-graydark-600">{hint}</p>
      )}
      {children}
    </Card>
  );
}

/** A card with one ApexChart, or a quiet message when there is nothing to draw. */
export function ChartPanel({
  title,
  hint,
  type,
  series,
  options,
  height = 280,
  empty,
  className = '',
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  type: ApexChartType;
  series: ApexOptions['series'];
  options?: ApexOptions;
  height?: number;
  empty: boolean;
  className?: string;
  /** Rendered under the chart (a legend table, for example). */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Card className={className}>
      <CardHeader title={title} className={hint ? 'mb-1' : ''} />
      {hint && (
        <p className="mb-3 text-xs leading-5 text-gray-500 dark:text-graydark-600">{hint}</p>
      )}
      {empty ? (
        <div className="flex items-center justify-center" style={{ height: Math.min(height, 220) }}>
          <p className="text-sm text-gray-500 dark:text-graydark-600">
            {t('operations.ui.chartEmpty')}
          </p>
        </div>
      ) : (
        <ApexChart type={type} series={series} options={options} height={height} />
      )}
      {children}
    </Card>
  );
}

/** Sortable report table whose wrapper can carry a `data-testid`. */
export function OpsTable<Row>({
  columns,
  rows,
  rowKey,
  testId,
  emptyKey,
}: {
  columns: Array<Column<Row>>;
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  testId?: string;
  emptyKey?: string;
}) {
  return (
    <div data-testid={testId}>
      <ReportsTable columns={columns} rows={rows} rowKey={rowKey} emptyKey={emptyKey} dense />
    </div>
  );
}

/** A table with a small heading above it. */
export function TableBlock({
  title,
  hint,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-gray-500 dark:text-graydark-600">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/** Seconds → hours with two decimals, locale digits. */
export function hoursText(sec: number | null | undefined, lang: string): string {
  if (sec === null || sec === undefined) return '—';
  return formatNumber(Math.round((sec / 3600) * 100) / 100, lang, { maximumFractionDigits: 2 });
}

/** Seconds → minutes with one decimal, locale digits. */
export function minutesText(sec: number | null | undefined, lang: string): string {
  if (sec === null || sec === undefined) return '—';
  return formatNumber(Math.round((sec / 60) * 10) / 10, lang, { maximumFractionDigits: 1 });
}

/** A count or measure with at most `digits` decimals, locale digits. */
export function numText(value: number | null | undefined, lang: string, digits = 1): string {
  if (value === null || value === undefined) return '—';
  return formatNumber(value, lang, { maximumFractionDigits: digits });
}

/** Chart-ready number: rounded, no formatting. */
export function round(value: number, digits = 1): number {
  const k = 10 ** digits;
  return Math.round(value * k) / k;
}

/** Cut a long label for a chart axis. */
export function clip(label: string, max = 16): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

export function stampText(value: string | null, lang: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-GB');
}

/** Shared axis options for a horizontal bar chart (long labels read better). */
export function horizontalBar(categories: string[]): ApexOptions {
  return {
    plotOptions: { bar: { horizontal: true, borderRadius: 5, barHeight: '58%' } },
    xaxis: { categories, labels: { hideOverlappingLabels: true } },
    yaxis: { labels: { maxWidth: 140 } },
    grid: { xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } } },
  };
}

/** Height for a horizontal bar chart with `rows` bars. */
export function barsHeight(rows: number, min = 220): number {
  return Math.max(min, 56 + rows * 34);
}

/**
 * Columns for one measure and a smooth line for another on a second axis
 * (services as columns, distance as the line, for example).
 */
export function comboChart(
  categories: string[],
  columns: { name: string; data: number[]; unit?: string },
  line: { name: string; data: number[]; unit?: string },
  lang: string,
): { series: NonNullable<ApexOptions['series']>; options: ApexOptions } {
  const dense = categories.length > 10;
  const tip = (unit: string | undefined) => (value: number) =>
    `${numText(value, lang)}${unit ? ` ${unit}` : ''}`;
  return {
    series: [
      { name: columns.name, type: 'column', data: columns.data },
      { name: line.name, type: 'line', data: line.data },
    ],
    options: {
      colors: [chart.distance, chart.engine],
      stroke: { width: [0, 3], curve: 'smooth' },
      fill: { type: ['gradient', 'solid'], opacity: [1, 1] },
      markers: { size: [0, 4], strokeWidth: 0, hover: { size: 6 } },
      plotOptions: { bar: { columnWidth: dense ? '50%' : '36%', borderRadius: 5 } },
      legend: { position: 'top', horizontalAlign: 'right' },
      xaxis: {
        categories,
        labels: { rotate: dense ? -40 : 0, hideOverlappingLabels: true, trim: true },
      },
      yaxis: [
        {
          seriesName: columns.name,
          min: 0,
          forceNiceScale: true,
          decimalsInFloat: 0,
          labels: { formatter: (v: number) => numText(v, lang, 0) },
        },
        {
          seriesName: line.name,
          opposite: true,
          min: 0,
          forceNiceScale: true,
          decimalsInFloat: 0,
          labels: { formatter: (v: number) => numText(v, lang, 0) },
        },
      ],
      tooltip: {
        shared: true,
        intersect: false,
        y: [{ formatter: tip(columns.unit) }, { formatter: tip(line.unit) }],
      },
    },
  };
}
