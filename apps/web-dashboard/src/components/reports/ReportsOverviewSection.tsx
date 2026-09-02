/**
 * ReportsOverviewSection — TailAdmin fleet-overview KPI cards + trend charts
 * (Sprint J §6/§34/§35, Phase 8 port). Every number is the backend's
 * documented KPI (REPORTING-KPI-DEFINITIONS.md); charts render
 * loading/empty/error states. KPI tiles reuse the dashboard's `KpiTile` and
 * chart labels are fully translated (no hardcoded English series names).
 */
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  Fence,
  Gauge,
  MapPin,
  Radio,
  Route,
  Timer,
  TrendingUp,
  Truck,
  WifiOff,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { type ReportRange, useFleetOverview, useTrend } from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { ApexChart } from '@/components/dashboard/ApexChart';
import { mixedDistanceTrips } from '@/components/dashboard/distance-trips-mixed';
import { KpiChip, KpiTile } from '@/components/dashboard/KpiTile';
import { Card, CardHeader, EmptyState, Skeleton } from '@/components/tailwind-ui';
import { hoursFromSec } from '@/lib/hours-from-sec';
import { chart } from '@/theme/palette';
import type { ApexOptions } from 'apexcharts';

export function ReportsOverviewSection({ range }: { range: ReportRange }) {
  const { t, i18n } = useTranslation();
  const overview = useFleetOverview(range);
  const trend = useTrend(range);

  if (overview.isLoading) {
    /* Layout-preserving skeleton — same shape as the loaded section (freshness
       note, KPI grid, 2+1 chart row, distribution card). */
    return (
      // biome-ignore lint/a11y/useSemanticElements: role=status loading region.
      <div className="flex flex-col gap-4" role="status" aria-label={t('common.loading')}>
        <Skeleton className="h-4 w-56" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 12 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows never reorder.
            <Skeleton key={i} className="h-[104px] rounded-2xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Skeleton className="h-[332px] rounded-2xl lg:col-span-2" />
          <Skeleton className="h-[332px] rounded-2xl" />
        </div>
        <Skeleton className="h-[272px] rounded-2xl" />
      </div>
    );
  }
  if (overview.isError) {
    return <ErrorState error={overview.error} onRetry={() => overview.refetch()} />;
  }
  const o = overview.data;
  if (!o) {
    /* No payload without an error — an honest empty state, never a fake one. */
    return (
      <Card flush className="p-2">
        <EmptyState icon={<Activity />} title={t('reports.empty')} />
      </Card>
    );
  }

  const mixed = mixedDistanceTrips(
    trend.data?.points ?? [],
    {
      distance: t('reports.labels.distance'),
      trips: t('reports.labels.trips'),
    },
    i18n.language,
  );

  return (
    <div className="flex flex-col gap-4">
      <p data-testid="report-freshness" className="text-xs text-gray-500 dark:text-graydark-600">
        {t('reports.freshness', {
          freshness:
            o.freshness === 'NEAR_REALTIME'
              ? t('reports.freshnessNear')
              : t('reports.freshnessAgg'),
          asOf: new Date(o.dataAsOf).toLocaleTimeString(),
        })}
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div data-testid="report-kpi">
          <KpiTile
            labelKey="reports.kpi.totalVehicles"
            value={o.totalVehicles}
            icon={Truck}
            tone="brand"
          />
        </div>
        <div data-testid="report-kpi">
          <KpiTile
            labelKey="reports.kpi.withTelemetry"
            value={o.vehiclesWithTelemetry}
            icon={Radio}
            tone="info"
          />
        </div>
        <div data-testid="report-kpi">
          <KpiTile
            labelKey="reports.kpi.moving"
            value={o.movingVehicles}
            icon={Gauge}
            tone="success"
          />
        </div>
        <div data-testid="report-kpi">
          <KpiTile
            labelKey="reports.kpi.idle"
            value={o.idleVehicles}
            icon={Activity}
            tone="warning"
          />
        </div>
        <div data-testid="report-kpi">
          <KpiTile
            labelKey="reports.kpi.parked"
            value={o.parkedVehicles}
            icon={MapPin}
            tone="gray"
          />
        </div>
        <div data-testid="report-kpi">
          <KpiTile
            labelKey="reports.kpi.noTelemetry"
            value={o.noTelemetryVehicles}
            icon={WifiOff}
            tone="gray"
          />
        </div>
        <div data-testid="report-kpi">
          {/* One decimal, matching the old toFixed(1) formatting; the leading
              space in the suffix keeps "281.7 km" readable as one string. */}
          <KpiTile
            labelKey="reports.kpi.distance"
            value={Math.round(o.totalDistanceKm * 10) / 10}
            suffix=" km"
            icon={Route}
            tone="brand"
          />
        </div>
        <div data-testid="report-kpi">
          <KpiTile
            labelKey="reports.kpi.trips"
            value={o.totalTrips}
            icon={ArrowRightLeft}
            tone="info"
          />
        </div>
        <div data-testid="report-kpi">
          <KpiTile
            labelKey="reports.kpi.alarms"
            value={o.totalAlarms}
            icon={AlertTriangle}
            tone={o.openAlarms > 0 ? 'danger' : 'gray'}
            footer={
              <KpiChip tone={o.openAlarms > 0 ? 'danger' : 'success'}>
                {o.openAlarms} {t('reports.kpi.open')}
              </KpiChip>
            }
          />
        </div>
        <div data-testid="report-kpi">
          <KpiTile
            labelKey="reports.kpi.geofenceEvents"
            value={o.geofenceEvents}
            icon={Fence}
            tone={o.geofenceEvents > 0 ? 'warning' : 'gray'}
          />
        </div>
        <div data-testid="report-kpi">
          <KpiTile
            labelKey="reports.kpi.utilization"
            value={o.avgUtilizationPct === null ? null : Math.round(o.avgUtilizationPct * 10) / 10}
            suffix="%"
            icon={TrendingUp}
            tone="success"
            footer={
              o.avgUtilizationPct === null ? (
                <KpiChip tone="gray">{t('reports.noData')}</KpiChip>
              ) : undefined
            }
          />
        </div>
        <div data-testid="report-kpi">
          <KpiTile
            labelKey="dashboard.stats.movingHours"
            value={hoursFromSec(o.movingDurationSec ?? 0)}
            suffix="h"
            icon={Timer}
            tone="success"
          />
        </div>
        <div data-testid="report-kpi">
          <KpiTile
            labelKey="dashboard.stats.avgSpeed"
            value={
              o.avgSpeedKmh === null || o.avgSpeedKmh === undefined
                ? null
                : Math.round(o.avgSpeedKmh)
            }
            suffix="km/h"
            icon={Gauge}
            tone="teal"
          />
        </div>
        <div data-testid="report-kpi">
          <KpiTile
            labelKey="dashboard.stats.maxSpeed"
            value={
              o.maxSpeedKmh === null || o.maxSpeedKmh === undefined
                ? null
                : Math.round(o.maxSpeedKmh)
            }
            suffix="km/h"
            icon={Zap}
            tone="info"
          />
        </div>
        <div data-testid="report-kpi">
          <KpiTile
            labelKey="dashboard.stats.speedingEvents"
            value={o.speedingEventCount ?? 0}
            icon={AlertTriangle}
            tone={(o.speedingEventCount ?? 0) > 0 ? 'danger' : 'gray'}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard title={t('reports.charts.distanceTrips')}>
            {trend.isLoading ? (
              <ChartLoading />
            ) : trend.isError ? (
              <ErrorState error={trend.error} onRetry={() => trend.refetch()} />
            ) : (trend.data?.points.length ?? 0) === 0 ? (
              <EmptyChart label={t('reports.charts.empty')} />
            ) : (
              <ApexChart
                type="line"
                series={mixed.series}
                options={mixed.options}
                height={300}
              />
            )}
          </ChartCard>
        </div>
        <ChartCard title={t('reports.charts.alarmTrend')}>
          {trend.isLoading ? (
            <ChartLoading />
          ) : trend.isError ? (
            <ErrorState error={trend.error} onRetry={() => trend.refetch()} />
          ) : (trend.data?.points.length ?? 0) === 0 ? (
            <EmptyChart label={t('reports.charts.empty')} />
          ) : (
            <ApexChart
              type="bar"
              series={alarmTrendSeries(trend.data?.points ?? [], {
                speeding: t('reports.labels.speeding'),
                geofence: t('reports.labels.geofence'),
                offline: t('reports.labels.offline'),
                other: t('reports.labels.other'),
              })}
              options={alarmTrendOptions(trend.data?.points ?? [], {
                speeding: t('reports.labels.speeding'),
                geofence: t('reports.labels.geofence'),
                offline: t('reports.labels.offline'),
                other: t('reports.labels.other'),
              })}
              height={280}
            />
          )}
        </ChartCard>
      </div>
      <ChartCard title={t('reports.charts.stateDistribution')}>
        {/* Same payload as the KPI row above, so loading/error are already
            handled — only the all-zero case needs its own empty state. */}
        {o.movingVehicles + o.idleVehicles + o.parkedVehicles + o.noTelemetryVehicles === 0 ? (
          <EmptyChart label={t('reports.charts.empty')} />
        ) : (
          <ApexChart
            type="donut"
            series={[o.movingVehicles, o.idleVehicles, o.parkedVehicles, o.noTelemetryVehicles]}
            options={distributionOptions({
              moving: t('reports.labels.moving'),
              idle: t('reports.labels.idle'),
              parked: t('reports.labels.parked'),
              noTelemetry: t('reports.labels.noTelemetry'),
            })}
            height={220}
          />
        )}
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <Card className="h-full">
      <CardHeader title={title} />
      {children}
    </Card>
  );
}

function ChartLoading() {
  return (
    // biome-ignore lint/a11y/useSemanticElements: role=status loading region.
    <div className="flex flex-col gap-2" role="status" aria-hidden>
      <Skeleton className="h-4 w-36" />
      <Skeleton className="h-[240px] w-full" />
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

// ── ApexCharts options (theme handled by ApexChart wrapper) ───────────────

function alarmTrendSeries(
  points: Array<{
    day: string;
    alarmSpeeding: number;
    alarmGeofence: number;
    alarmOffline: number;
    alarmOther: number;
  }>,
  labels: { speeding: string; geofence: string; offline: string; other: string },
) {
  return [
    { name: labels.speeding, data: points.map((p) => p.alarmSpeeding) },
    { name: labels.geofence, data: points.map((p) => p.alarmGeofence) },
    { name: labels.offline, data: points.map((p) => p.alarmOffline) },
    { name: labels.other, data: points.map((p) => p.alarmOther) },
  ];
}

function alarmTrendOptions(
  points: Array<{ day: string }>,
  _labels: { speeding: string; geofence: string; offline: string; other: string },
): ApexOptions {
  return {
    chart: { stacked: true },
    colors: [chart.speeding, chart.geofence, chart.offline, chart.other],
    plotOptions: { bar: { columnWidth: '52%', borderRadius: 4 } },
    xaxis: { categories: points.map((p) => p.day) },
    legend: { position: 'bottom' },
  };
}

function distributionOptions(labels: {
  moving: string;
  idle: string;
  parked: string;
  noTelemetry: string;
}): ApexOptions {
  return {
    labels: [labels.moving, labels.idle, labels.parked, labels.noTelemetry],
    colors: [chart.moving, chart.idle, chart.parked, chart.noTelemetry],
    legend: { position: 'bottom' },
    plotOptions: {
      pie: {
        donut: {
          size: '62%',
          labels: { show: true, total: { show: true, label: '' } },
        },
      },
    },
  };
}
