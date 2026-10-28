/**
 * StopsSection — parking / idle (توقفات) with Apex charts + period table.
 */
import type { ApexOptions } from 'apexcharts';
import { Clock, MapPin, Timer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type PeriodRowWire,
  type PlannedStopSummaryWire,
  type ReportRange,
  useFleetOverview,
  useIdleParking,
  useVehicleMeters,
} from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { ApexChart } from '@/components/dashboard/ApexChart';
import { KpiTile } from '@/components/dashboard/KpiTile';
import { type Column, ReportsTable } from '@/components/reports/ReportsTable';
import { startEndColumns } from '@/components/reports/dateTimeColumns';
import { Badge, Card, CardHeader, Skeleton } from '@/components/tailwind-ui';
import { formatDurationSec, hours1, shortLabel } from '@/lib/report-format';
import { chart } from '@/theme/palette';

type StopCategoryFilter = 'all' | 'OPERATIONAL' | 'LUNCH' | 'HANDOVER';
const CATEGORY_FILTERS: StopCategoryFilter[] = ['all', 'OPERATIONAL', 'LUNCH', 'HANDOVER'];

function StopCategoryBadge({ category }: { category: PeriodRowWire['category'] }) {
  const { t } = useTranslation();
  const value = category ?? 'OPERATIONAL';
  const tone = value === 'LUNCH' ? 'info' : value === 'HANDOVER' ? 'warning' : 'gray';
  return <Badge color={tone}>{t(`reports.stopCategory.${value}`)}</Badge>;
}

/** The stops of the machine apart from lunch and the shift handover. */
function PlannedStopsPanel({ summary }: { summary: PlannedStopSummaryWire }) {
  const { t } = useTranslation();
  const cells: Array<{ id: 'operational' | 'lunch' | 'handover'; label: string }> = [
    { id: 'operational', label: t('reports.stopCategory.OPERATIONAL') },
    { id: 'lunch', label: t('reports.stopCategory.LUNCH') },
    { id: 'handover', label: t('reports.stopCategory.HANDOVER') },
  ];
  return (
    <Card data-testid="report-stops-split">
      <CardHeader title={t('reports.stopCategory.title')} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {cells.map(({ id, label }) => (
          <div
            key={id}
            className="rounded-xl border border-gray-200 px-4 py-3 dark:border-white/10"
            data-testid={`stops-split-${id}`}
          >
            <p className="text-xs text-gray-500 dark:text-graydark-600">{label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-gray-800 dark:text-white">
              {formatDurationSec(summary[id].sec)}
            </p>
            <p className="text-xs tabular-nums text-gray-500 dark:text-graydark-600">
              {t('reports.stopCategory.count', { count: summary[id].count })}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-gray-500 dark:text-graydark-600">
        {t('reports.stopCategory.hint')}
        {summary.truncated ? ` ${t('reports.stopCategory.truncated')}` : ''}
      </p>
    </Card>
  );
}

export function StopsSection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const overview = useFleetOverview(range);
  const meters = useVehicleMeters(range);
  const [kind, setKind] = useState<'IDLE' | 'PARKING' | undefined>(undefined);
  const periods = useIdleParking(range, { kind });

  const rows = meters.data?.items ?? [];
  const o = overview.data;
  const [category, setCategory] = useState<StopCategoryFilter>('all');
  const planned = periods.data?.summary;
  const visibleRows = useMemo(
    () =>
      (periods.data?.items ?? []).filter(
        (r) => category === 'all' || (r.category ?? 'OPERATIONAL') === category,
      ),
    [periods.data, category],
  );

  const mix = useMemo(() => {
    const idle = hours1(o?.idleDurationSec ?? rows.reduce((s, r) => s + r.idleSec, 0));
    const parking = hours1(o?.parkingDurationSec ?? rows.reduce((s, r) => s + r.parkingSec, 0));
    return [
      { label: t('reports.labels.idle'), value: idle, color: chart.idle },
      { label: t('reports.labels.parked'), value: parking, color: chart.parked },
    ].filter((s) => s.value > 0);
  }, [o, rows, t]);

  const topStops = useMemo(
    () =>
      [...rows].sort((a, b) => b.parkingSec + b.idleSec - (a.parkingSec + a.idleSec)).slice(0, 10),
    [rows],
  );

  const donutOptions = useMemo<ApexOptions>(
    () => ({
      labels: mix.map((s) => s.label),
      colors: mix.map((s) => s.color),
      legend: { position: 'bottom' },
      plotOptions: {
        pie: {
          donut: {
            size: '68%',
            labels: {
              show: true,
              total: {
                show: true,
                label: t('reports.charts.totalHours'),
                formatter: () => mix.reduce((a, b) => a + b.value, 0).toFixed(1),
              },
            },
          },
        },
      },
      tooltip: { y: { formatter: (v: number) => `${v.toFixed(1)} h` } },
    }),
    [mix, t],
  );

  const barOptions = useMemo<ApexOptions>(
    () => ({
      chart: { stacked: true },
      colors: [chart.idle, chart.parked],
      plotOptions: { bar: { horizontal: true, barHeight: '68%', borderRadius: 6 } },
      xaxis: { categories: topStops.map((r) => shortLabel(r.label)) },
      tooltip: { y: { formatter: (v: number) => `${v.toFixed(1)} h` } },
    }),
    [topStops],
  );

  const barSeries = useMemo(
    () => [
      { name: t('reports.cols.idle'), data: topStops.map((r) => hours1(r.idleSec)) },
      { name: t('reports.cols.parking'), data: topStops.map((r) => hours1(r.parkingSec)) },
    ],
    [topStops, t],
  );

  const columns: Column<NonNullable<typeof periods.data>['items'][number]>[] = [
    { id: 'kind', headerKey: 'reports.cols.kind', render: (r) => r.kind },
    { id: 'label', headerKey: 'reports.cols.vehicle', render: (r) => r.label },
    ...startEndColumns<PeriodRowWire>(
      (r) => r.startedAt,
      (r) => r.endedAt,
    ),
    {
      id: 'duration',
      headerKey: 'reports.cols.duration',
      render: (r) => formatDurationSec(r.durationSec),
    },
    {
      id: 'category',
      headerKey: 'reports.cols.stopCategory',
      render: (r) => <StopCategoryBadge category={r.category} />,
    },
    {
      id: 'status',
      headerKey: 'reports.cols.status',
      render: (r) =>
        r.status ? (
          <Badge color={r.status === 'TAMPER' ? 'danger' : 'gray'}>{r.status}</Badge>
        ) : (
          '—'
        ),
    },
  ];

  const chip = (active: boolean) =>
    `h-7 cursor-pointer rounded-full border px-3 text-xs font-semibold transition-colors ${
      active
        ? 'border-brand-500 bg-brand-500 text-white'
        : 'border-gray-300 bg-transparent text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:text-graydark-700 dark:hover:bg-white/5'
    }`;

  if (overview.isLoading && meters.isLoading) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: role=status loading region.
      <div className="flex flex-col gap-4" role="status">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows never reorder.
            <Skeleton key={i} className="h-[104px] rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-[280px] rounded-2xl" />
      </div>
    );
  }

  if (overview.isError) {
    return <ErrorState error={overview.error} onRetry={() => overview.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-4" data-testid="report-stops">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <KpiTile
          labelKey="reports.kpi.parked"
          value={o?.parkedVehicles ?? 0}
          icon={MapPin}
          tone="gray"
        />
        <KpiTile
          labelKey="reports.stops.idleHours"
          value={hours1(o?.idleDurationSec ?? 0)}
          suffix="h"
          icon={Timer}
          tone="warning"
        />
        <KpiTile
          labelKey="reports.stops.parkingHours"
          value={hours1(o?.parkingDurationSec ?? 0)}
          suffix="h"
          icon={Clock}
          tone="info"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader title={t('reports.charts.stopMix')} />
          {mix.length === 0 ? (
            <EmptyChart label={t('reports.charts.empty')} />
          ) : (
            <ApexChart
              type="donut"
              series={mix.map((s) => s.value)}
              options={donutOptions}
              height={260}
            />
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title={t('reports.charts.stopsByVehicle')} />
          {topStops.length === 0 ? (
            <EmptyChart label={t('reports.charts.empty')} />
          ) : (
            <ApexChart type="bar" series={barSeries} options={barOptions} height={260} />
          )}
        </Card>
      </div>

      {planned && <PlannedStopsPanel summary={planned} />}

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className={chip(kind === undefined)}
          onClick={() => setKind(undefined)}
        >
          {t('reports.idleParking.all')}
        </button>
        <button type="button" className={chip(kind === 'IDLE')} onClick={() => setKind('IDLE')}>
          {t('reports.idleParking.idle')}
        </button>
        <button
          type="button"
          className={chip(kind === 'PARKING')}
          onClick={() => setKind('PARKING')}
        >
          {t('reports.idleParking.parking')}
        </button>
        <span aria-hidden className="mx-1 w-px self-stretch bg-gray-200 dark:bg-white/10" />
        {CATEGORY_FILTERS.map((id) => (
          <button
            key={id}
            type="button"
            className={chip(category === id)}
            aria-pressed={category === id}
            onClick={() => setCategory(id)}
            data-testid={`stop-category-${id}`}
          >
            {t(`reports.stopCategory.${id}`)}
          </button>
        ))}
      </div>
      {periods.isLoading ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : periods.isError ? (
        <ErrorState error={periods.error} onRetry={() => periods.refetch()} />
      ) : (
        <ReportsTable
          columns={columns}
          rows={visibleRows}
          rowKey={(r) => r.id}
          emptyKey="reports.empty"
          dense
        />
      )}
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center">
      <p className="text-sm text-gray-500 dark:text-graydark-600">{label}</p>
    </div>
  );
}
