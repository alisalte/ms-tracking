/**
 * DistanceSection — kilometres travelled per vehicle + daily trend.
 */
import type { ApexOptions } from 'apexcharts';
import { ArrowRightLeft, Ban, Route } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type DistanceRowWire,
  type ReportRange,
  useDistance,
  useFleetOverview,
  useTrend,
} from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { ApexChart } from '@/components/dashboard/ApexChart';
import { KpiTile } from '@/components/dashboard/KpiTile';
import { mixedDistanceTrips } from '@/components/dashboard/distance-trips-mixed';
import { type Column, ReportsTable } from '@/components/reports/ReportsTable';
import { Card, CardHeader, Skeleton } from '@/components/tailwind-ui';
import { shortLabel } from '@/lib/report-format';
import { chart } from '@/theme/palette';

export function DistanceSection({ range }: { range: ReportRange }) {
  const { t, i18n } = useTranslation();
  const overview = useFleetOverview(range);
  const distance = useDistance(range);
  const trend = useTrend(range);
  const rows = distance.data?.items ?? [];
  const o = overview.data;

  const chartRows = useMemo(
    () => [...rows].sort((a, b) => b.distanceKm - a.distanceKm).slice(0, 12),
    [rows],
  );
  const mixed = mixedDistanceTrips(
    trend.data?.points ?? [],
    { distance: t('reports.labels.distance'), trips: t('reports.labels.trips') },
    i18n.language,
  );

  const barOptions = useMemo<ApexOptions>(
    () => ({
      colors: [chart.distance],
      plotOptions: { bar: { borderRadius: 6, columnWidth: '48%' } },
      xaxis: {
        categories: chartRows.map((r) => shortLabel(r.label, 14)),
        labels: { rotate: -35, hideOverlappingLabels: true },
      },
      tooltip: { y: { formatter: (v: number) => `${v.toFixed(1)} km` } },
    }),
    [chartRows],
  );
  const barSeries = useMemo(
    () => [
      {
        name: t('reports.cols.distance'),
        data: chartRows.map((r) => Number(r.distanceKm.toFixed(1))),
      },
    ],
    [chartRows, t],
  );

  const totalKm = o?.totalDistanceKm ?? rows.reduce((s, r) => s + r.distanceKm, 0);
  const totalTrips = o?.totalTrips ?? rows.reduce((s, r) => s + r.trips, 0);
  const discarded = o?.discardedTrips ?? rows.reduce((s, r) => s + r.discardedTrips, 0);
  const avgTrip = totalTrips > 0 ? totalKm / totalTrips : null;

  const columns: Column<DistanceRowWire>[] = [
    { id: 'label', headerKey: 'reports.cols.vehicle', render: (r) => r.label },
    {
      id: 'distance',
      headerKey: 'reports.cols.distance',
      render: (r) => `${r.distanceKm.toFixed(1)} km`,
    },
    { id: 'trips', headerKey: 'reports.cols.trips', render: (r) => String(r.trips) },
    {
      id: 'avg',
      headerKey: 'reports.cols.avgTrip',
      render: (r) => (r.avgTripKm === null ? '—' : `${r.avgTripKm.toFixed(1)} km`),
    },
    {
      id: 'max',
      headerKey: 'reports.cols.maxTrip',
      render: (r) => (r.maxTripKm === null ? '—' : `${r.maxTripKm.toFixed(1)} km`),
    },
    {
      id: 'discarded',
      headerKey: 'reports.cols.discarded',
      render: (r) => String(r.discardedTrips),
    },
  ];

  if (distance.isLoading && overview.isLoading) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: role=status loading region.
      <div className="flex flex-col gap-4" role="status">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows never reorder.
            <Skeleton key={i} className="h-[104px] rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-[280px] rounded-2xl" />
      </div>
    );
  }

  if (distance.isError) {
    return <ErrorState error={distance.error} onRetry={() => distance.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-4" data-testid="report-distance">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile
          labelKey="reports.kpi.distance"
          value={Math.round(totalKm * 10) / 10}
          suffix=" km"
          icon={Route}
          tone="brand"
        />
        <KpiTile
          labelKey="reports.kpi.trips"
          value={totalTrips}
          icon={ArrowRightLeft}
          tone="info"
        />
        <KpiTile
          labelKey="reports.kpi.avgTrip"
          value={avgTrip === null ? null : Math.round(avgTrip * 10) / 10}
          suffix=" km"
          icon={Route}
          tone="teal"
        />
        <KpiTile labelKey="reports.kpi.discarded" value={discarded} icon={Ban} tone="gray" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('reports.charts.distanceByVehicle')} />
          {chartRows.length === 0 ? (
            <EmptyChart label={t('reports.charts.empty')} />
          ) : (
            <ApexChart type="bar" series={barSeries} options={barOptions} height={280} />
          )}
        </Card>
        <Card>
          <CardHeader title={t('reports.charts.distanceTrips')} />
          {(trend.data?.points.length ?? 0) === 0 ? (
            <EmptyChart label={t('reports.charts.empty')} />
          ) : (
            <ApexChart type="line" series={mixed.series} options={mixed.options} height={280} />
          )}
        </Card>
      </div>

      <ReportsTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.vehicleId}
        emptyKey="reports.empty"
        dense
      />
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
