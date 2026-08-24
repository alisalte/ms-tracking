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
  TrendingUp,
  Truck,
  WifiOff,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { type ReportRange, useFleetOverview, useTrend } from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { EChart } from '@/components/dashboard/EChart';
import { KpiChip, KpiTile } from '@/components/dashboard/KpiTile';
import { Card, CardHeader, EmptyState, Skeleton } from '@/components/tailwind-ui';
import type { EChartsOption } from 'echarts';

export function ReportsOverviewSection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
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
          {Array.from({ length: 8 }, (_, i) => (
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
              <EChart
                option={distanceTripsOption(trend.data?.points ?? [], {
                  distance: t('reports.labels.distance'),
                  trips: t('reports.labels.trips'),
                  km: t('reports.labels.km'),
                })}
                height={280}
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
            <EChart
              option={alarmTrendOption(trend.data?.points ?? [], {
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
          <EChart
            option={distributionOption(o, {
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

// ── ECharts options (theme handled by the shared EChart wrapper) ───────────

function distanceTripsOption(
  points: Array<{ day: string; distanceKm: number; trips: number }>,
  labels: { distance: string; trips: string; km: string },
): EChartsOption {
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: [labels.distance, labels.trips] },
    xAxis: { type: 'category' as const, data: points.map((p) => p.day) },
    yAxis: [
      { type: 'value' as const, name: labels.km },
      { type: 'value' as const, name: labels.trips },
    ],
    series: [
      {
        name: labels.distance,
        type: 'line' as const,
        smooth: true,
        areaStyle: { opacity: 0.15 },
        data: points.map((p) => Number(p.distanceKm.toFixed(1))),
      },
      {
        name: labels.trips,
        type: 'bar' as const,
        yAxisIndex: 1,
        data: points.map((p) => p.trips),
      },
    ],
  };
}

function alarmTrendOption(
  points: Array<{
    day: string;
    alarmSpeeding: number;
    alarmGeofence: number;
    alarmOffline: number;
    alarmOther: number;
  }>,
  labels: { speeding: string; geofence: string; offline: string; other: string },
): EChartsOption {
  const keys = ['alarmSpeeding', 'alarmGeofence', 'alarmOffline', 'alarmOther'] as const;
  const names = [labels.speeding, labels.geofence, labels.offline, labels.other];
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: names },
    xAxis: { type: 'category' as const, data: points.map((p) => p.day) },
    yAxis: { type: 'value' as const },
    series: keys.map((k, i) => ({
      name: names[i],
      type: 'bar' as const,
      stack: 'alarms',
      data: points.map((p) => p[k]),
    })),
  };
}

function distributionOption(
  o: {
    movingVehicles: number;
    idleVehicles: number;
    parkedVehicles: number;
    noTelemetryVehicles: number;
  },
  labels: { moving: string; idle: string; parked: string; noTelemetry: string },
): EChartsOption {
  return {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [
      {
        type: 'pie' as const,
        radius: ['40%', '70%'],
        avoidLabelOverlap: true,
        data: [
          { name: labels.moving, value: o.movingVehicles },
          { name: labels.idle, value: o.idleVehicles },
          { name: labels.parked, value: o.parkedVehicles },
          { name: labels.noTelemetry, value: o.noTelemetryVehicles },
        ],
      },
    ],
  };
}
