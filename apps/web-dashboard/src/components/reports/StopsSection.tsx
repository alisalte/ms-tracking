/**
 * StopsSection — parking / idle (توقفات) with Apex charts + period table.
 */
import type { ApexOptions } from 'apexcharts';
import { Clock, MapPin, Timer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type ReportRange,
  useFleetOverview,
  useIdleParking,
  useVehicleMeters,
} from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { ApexChart } from '@/components/dashboard/ApexChart';
import { KpiTile } from '@/components/dashboard/KpiTile';
import { type Column, ReportsTable } from '@/components/reports/ReportsTable';
import { Badge, Card, CardHeader, Skeleton } from '@/components/tailwind-ui';
import { formatDurationSec, hours1, shortLabel } from '@/lib/report-format';
import { chart } from '@/theme/palette';

export function StopsSection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const overview = useFleetOverview(range);
  const meters = useVehicleMeters(range);
  const [kind, setKind] = useState<'IDLE' | 'PARKING' | undefined>(undefined);
  const periods = useIdleParking(range, { kind });

  const rows = meters.data?.items ?? [];
  const o = overview.data;

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
    {
      id: 'start',
      headerKey: 'reports.cols.start',
      render: (r) => new Date(r.startedAt).toLocaleString(),
    },
    {
      id: 'end',
      headerKey: 'reports.cols.end',
      render: (r) => (r.endedAt ? new Date(r.endedAt).toLocaleString() : '—'),
    },
    {
      id: 'duration',
      headerKey: 'reports.cols.duration',
      render: (r) => formatDurationSec(r.durationSec),
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

      <div className="flex gap-1.5">
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
      </div>
      {periods.isLoading ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : periods.isError ? (
        <ErrorState error={periods.error} onRetry={() => periods.refetch()} />
      ) : (
        <ReportsTable
          columns={columns}
          rows={periods.data?.items ?? []}
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
