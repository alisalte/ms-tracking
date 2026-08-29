/**
 * OdometerSection — registry counter + period distance (کیلومترشمار).
 */
import type { ApexOptions } from 'apexcharts';
import { Gauge, Route, Truck } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type ReportRange, type VehicleMetersRowWire, useVehicleMeters } from '@/api/report.api';
import { formatOdometerKm } from '@/components/assets/asset-meta';
import { ErrorState } from '@/components/common/ErrorState';
import { ApexChart } from '@/components/dashboard/ApexChart';
import { KpiTile } from '@/components/dashboard/KpiTile';
import { type Column, ReportsTable } from '@/components/reports/ReportsTable';
import { Card, CardHeader, Skeleton } from '@/components/tailwind-ui';
import { shortLabel } from '@/lib/report-format';
import { mapAccents, status } from '@/theme/palette';

function startKm(r: VehicleMetersRowWire): number | null {
  if (r.odometerKm === null) return null;
  return Math.max(0, Math.round((r.odometerKm - r.periodDistanceKm) * 10) / 10);
}

export function OdometerSection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const meters = useVehicleMeters(range);
  const rows = meters.data?.items ?? [];

  const chartRows = useMemo(
    () => [...rows].sort((a, b) => b.periodDistanceKm - a.periodDistanceKm).slice(0, 12),
    [rows],
  );

  const totalPeriod = rows.reduce((s, r) => s + r.periodDistanceKm, 0);
  const withOdo = rows.filter((r) => r.odometerKm !== null).length;

  const barOptions = useMemo<ApexOptions>(
    () => ({
      colors: [mapAccents.selectedRoute],
      plotOptions: { bar: { borderRadius: 3, columnWidth: '52%' } },
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
        data: chartRows.map((r) => Number(r.periodDistanceKm.toFixed(1))),
      },
    ],
    [chartRows, t],
  );

  const odoOptions = useMemo<ApexOptions>(
    () => ({
      colors: [status.info],
      plotOptions: { bar: { horizontal: true, barHeight: '68%', borderRadius: 3 } },
      xaxis: { categories: chartRows.map((r) => shortLabel(r.label)) },
      tooltip: { y: { formatter: (v: number) => `${v.toLocaleString()} km` } },
    }),
    [chartRows],
  );

  const odoSeries = useMemo(
    () => [
      {
        name: t('reports.cols.odometer'),
        data: chartRows.map((r) => (r.odometerKm === null ? 0 : Number(r.odometerKm.toFixed(1)))),
      },
    ],
    [chartRows, t],
  );

  const columns: Column<VehicleMetersRowWire>[] = [
    { id: 'label', headerKey: 'reports.cols.vehicle', render: (r) => r.label },
    {
      id: 'start',
      headerKey: 'reports.cols.odometerStart',
      render: (r) => formatOdometerKm(startKm(r)),
    },
    {
      id: 'period',
      headerKey: 'reports.cols.distance',
      render: (r) => `${r.periodDistanceKm.toFixed(1)} km`,
    },
    {
      id: 'end',
      headerKey: 'reports.cols.odometer',
      render: (r) => formatOdometerKm(r.odometerKm),
    },
    { id: 'trips', headerKey: 'reports.cols.trips', render: (r) => String(r.trips) },
  ];

  if (meters.isLoading) {
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
    <div className="flex flex-col gap-4" data-testid="report-odometer">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <KpiTile
          labelKey="reports.kpi.distance"
          value={Math.round(totalPeriod * 10) / 10}
          suffix=" km"
          icon={Route}
          tone="brand"
        />
        <KpiTile labelKey="reports.odometer.withCounter" value={withOdo} icon={Gauge} tone="info" />
        <KpiTile
          labelKey="reports.kpi.trips"
          value={rows.reduce((s, r) => s + r.trips, 0)}
          icon={Truck}
          tone="teal"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('reports.charts.periodDistance')} />
          {chartRows.every((r) => r.periodDistanceKm === 0) ? (
            <EmptyChart label={t('reports.charts.empty')} />
          ) : (
            <ApexChart type="bar" series={barSeries} options={barOptions} height={280} />
          )}
        </Card>
        <Card>
          <CardHeader title={t('reports.charts.odometer')} />
          {chartRows.every((r) => r.odometerKm === null) ? (
            <EmptyChart label={t('reports.charts.empty')} />
          ) : (
            <ApexChart type="bar" series={odoSeries} options={odoOptions} height={280} />
          )}
        </Card>
      </div>

      <p className="text-xs text-gray-500 dark:text-graydark-600">{t('reports.odometer.note')}</p>
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
