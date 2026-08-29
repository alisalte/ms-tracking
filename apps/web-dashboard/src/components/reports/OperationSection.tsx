/**
 * OperationSection — working hours / utilization (کارکرد) with Apex charts.
 */
import type { ApexOptions } from 'apexcharts';
import { Gauge, Timer, TrendingUp } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type ReportRange,
  type VehicleMetersRowWire,
  useFleetOverview,
  useVehicleMeters,
} from '@/api/report.api';
import { formatEngineHours } from '@/components/assets/asset-meta';
import { ErrorState } from '@/components/common/ErrorState';
import { ApexChart } from '@/components/dashboard/ApexChart';
import { KpiTile } from '@/components/dashboard/KpiTile';
import { type Column, ReportsTable } from '@/components/reports/ReportsTable';
import { Card, CardHeader, Skeleton } from '@/components/tailwind-ui';
import { formatDurationSec, hours1, shortLabel } from '@/lib/report-format';
import { status } from '@/theme/palette';

export function OperationSection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const overview = useFleetOverview(range);
  const meters = useVehicleMeters(range);
  const rows = meters.data?.items ?? [];
  const o = overview.data;

  const chartRows = useMemo(
    () => [...rows].sort((a, b) => b.movingSec - a.movingSec).slice(0, 12),
    [rows],
  );

  const stackedOptions = useMemo<ApexOptions>(
    () => ({
      chart: { stacked: true },
      colors: [status.success, status.warning, status.slate],
      plotOptions: { bar: { horizontal: true, barHeight: '70%', borderRadius: 2 } },
      xaxis: { categories: chartRows.map((r) => shortLabel(r.label)) },
      tooltip: { y: { formatter: (v: number) => `${v.toFixed(1)} h` } },
    }),
    [chartRows],
  );

  const stackedSeries = useMemo(
    () => [
      { name: t('reports.cols.moving'), data: chartRows.map((r) => hours1(r.movingSec)) },
      { name: t('reports.cols.idle'), data: chartRows.map((r) => hours1(r.idleSec)) },
      { name: t('reports.cols.parking'), data: chartRows.map((r) => hours1(r.parkingSec)) },
    ],
    [chartRows, t],
  );

  const engineSeriesRows = useMemo(
    () =>
      [...rows]
        .map((r) => ({
          ...r,
          periodH: hours1(r.periodEngineHoursSec > 0 ? r.periodEngineHoursSec : r.movingSec),
        }))
        .sort((a, b) => b.periodH - a.periodH)
        .slice(0, 12),
    [rows],
  );

  const engineOptions = useMemo<ApexOptions>(
    () => ({
      colors: [status.teal],
      plotOptions: { bar: { borderRadius: 3, columnWidth: '55%' } },
      xaxis: {
        categories: engineSeriesRows.map((r) => shortLabel(r.label, 14)),
        labels: { rotate: -35, hideOverlappingLabels: true },
      },
      tooltip: { y: { formatter: (v: number) => `${v.toFixed(1)} h` } },
    }),
    [engineSeriesRows],
  );

  const engineSeries = useMemo(
    () => [
      { name: t('reports.operation.periodHours'), data: engineSeriesRows.map((r) => r.periodH) },
    ],
    [engineSeriesRows, t],
  );

  const periodEngine = rows.reduce((s, r) => s + r.periodEngineHoursSec, 0);

  const columns: Column<VehicleMetersRowWire>[] = [
    { id: 'label', headerKey: 'reports.cols.vehicle', render: (r) => r.label },
    {
      id: 'moving',
      headerKey: 'reports.cols.moving',
      render: (r) => formatDurationSec(r.movingSec),
    },
    { id: 'idle', headerKey: 'reports.cols.idle', render: (r) => formatDurationSec(r.idleSec) },
    {
      id: 'parking',
      headerKey: 'reports.cols.parking',
      render: (r) => formatDurationSec(r.parkingSec),
    },
    {
      id: 'periodEh',
      headerKey: 'reports.cols.periodEngineHours',
      render: (r) =>
        formatDurationSec(r.periodEngineHoursSec > 0 ? r.periodEngineHoursSec : r.movingSec),
    },
    {
      id: 'registryEh',
      headerKey: 'reports.cols.engineHours',
      render: (r) => formatEngineHours(r.engineHours),
    },
  ];

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

  if (meters.isError) {
    return <ErrorState error={meters.error} onRetry={() => meters.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-4" data-testid="report-operation">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <KpiTile
          labelKey="dashboard.stats.movingHours"
          value={hours1(o?.movingDurationSec ?? rows.reduce((s, r) => s + r.movingSec, 0))}
          suffix="h"
          icon={Timer}
          tone="success"
        />
        <KpiTile
          labelKey="reports.operation.periodHours"
          value={hours1(periodEngine > 0 ? periodEngine : (o?.movingDurationSec ?? 0))}
          suffix="h"
          icon={Gauge}
          tone="teal"
        />
        <KpiTile
          labelKey="reports.kpi.utilization"
          value={
            o?.avgUtilizationPct === null || o?.avgUtilizationPct === undefined
              ? null
              : Math.round(o.avgUtilizationPct * 10) / 10
          }
          suffix="%"
          icon={TrendingUp}
          tone="success"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('reports.charts.operationMix')} />
          {chartRows.length === 0 ? (
            <EmptyChart label={t('reports.charts.empty')} />
          ) : (
            <ApexChart type="bar" series={stackedSeries} options={stackedOptions} height={280} />
          )}
        </Card>
        <Card>
          <CardHeader title={t('reports.charts.engineHours')} />
          {engineSeriesRows.every((r) => r.periodH === 0) ? (
            <EmptyChart label={t('reports.charts.empty')} />
          ) : (
            <ApexChart type="bar" series={engineSeries} options={engineOptions} height={280} />
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
