/**
 * SpeedSection — average / peak speed and speeding alarms per vehicle.
 */
import type { ApexOptions } from 'apexcharts';
import { AlertTriangle, Gauge, Truck, Zap } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type ReportRange, type SpeedRowWire, useFleetOverview, useSpeed } from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { ApexChart } from '@/components/dashboard/ApexChart';
import { KpiTile } from '@/components/dashboard/KpiTile';
import { type Column, ReportsTable } from '@/components/reports/ReportsTable';
import { Card, CardHeader, Skeleton } from '@/components/tailwind-ui';
import { shortLabel } from '@/lib/report-format';
import { chart } from '@/theme/palette';

export function SpeedSection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const overview = useFleetOverview(range);
  const speed = useSpeed(range);
  const rows = speed.data?.items ?? [];
  const o = overview.data;

  const chartRows = useMemo(
    () => [...rows].sort((a, b) => (b.maxSpeedKph ?? 0) - (a.maxSpeedKph ?? 0)).slice(0, 12),
    [rows],
  );
  const speedingVehicles = rows.filter((r) => r.speedingAlarms > 0).length;

  const barOptions = useMemo<ApexOptions>(
    () => ({
      colors: [chart.distance, chart.peak],
      plotOptions: { bar: { borderRadius: 6, columnWidth: '48%' } },
      xaxis: {
        categories: chartRows.map((r) => shortLabel(r.label, 14)),
        labels: { rotate: -35, hideOverlappingLabels: true },
      },
      tooltip: { y: { formatter: (v: number) => `${v.toFixed(0)} km/h` } },
    }),
    [chartRows],
  );
  const barSeries = useMemo(
    () => [
      {
        name: t('reports.cols.avgSpeed'),
        data: chartRows.map((r) => (r.avgSpeedKph === null ? 0 : Number(r.avgSpeedKph.toFixed(1)))),
      },
      {
        name: t('reports.cols.maxSpeed'),
        data: chartRows.map((r) => (r.maxSpeedKph === null ? 0 : Number(r.maxSpeedKph.toFixed(0)))),
      },
    ],
    [chartRows, t],
  );

  const columns: Column<SpeedRowWire>[] = [
    { id: 'label', headerKey: 'reports.cols.vehicle', render: (r) => r.label },
    {
      id: 'avg',
      headerKey: 'reports.cols.avgSpeed',
      render: (r) => (r.avgSpeedKph === null ? '—' : `${r.avgSpeedKph.toFixed(1)} km/h`),
    },
    {
      id: 'max',
      headerKey: 'reports.cols.maxSpeed',
      render: (r) => (r.maxSpeedKph === null ? '—' : `${r.maxSpeedKph.toFixed(0)} km/h`),
    },
    {
      id: 'speeding',
      headerKey: 'reports.cols.speeding',
      render: (r) => String(r.speedingAlarms),
    },
  ];

  if (speed.isLoading && overview.isLoading) {
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

  if (speed.isError) {
    return <ErrorState error={speed.error} onRetry={() => speed.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-4" data-testid="report-speed">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile
          labelKey="dashboard.stats.avgSpeed"
          value={
            o?.avgSpeedKmh === null || o?.avgSpeedKmh === undefined
              ? null
              : Math.round(o.avgSpeedKmh)
          }
          suffix="km/h"
          icon={Gauge}
          tone="teal"
        />
        <KpiTile
          labelKey="dashboard.stats.maxSpeed"
          value={
            o?.maxSpeedKmh === null || o?.maxSpeedKmh === undefined
              ? null
              : Math.round(o.maxSpeedKmh)
          }
          suffix="km/h"
          icon={Zap}
          tone="info"
        />
        <KpiTile
          labelKey="dashboard.stats.speedingEvents"
          value={o?.speedingEventCount ?? rows.reduce((s, r) => s + r.speedingAlarms, 0)}
          icon={AlertTriangle}
          tone={(o?.speedingEventCount ?? speedingVehicles) > 0 ? 'danger' : 'gray'}
        />
        <KpiTile
          labelKey="reports.kpi.speedingVehicles"
          value={speedingVehicles}
          icon={Truck}
          tone={speedingVehicles > 0 ? 'warning' : 'success'}
        />
      </div>

      <Card>
        <CardHeader title={t('reports.charts.speedByVehicle')} />
        {chartRows.length === 0 ? (
          <EmptyChart label={t('reports.charts.empty')} />
        ) : (
          <ApexChart type="bar" series={barSeries} options={barOptions} height={280} />
        )}
      </Card>

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
