/**
 * ReportsOverviewSection — TailAdmin fleet-overview KPI cards + trend charts
 * (Sprint J §6/§34/§35, Phase 8 port). Every number is the backend's
 * documented KPI (REPORTING-KPI-DEFINITIONS.md); charts render
 * loading/empty/error states.
 */
import { useTranslation } from 'react-i18next';

import { type ReportRange, useFleetOverview, useTrend } from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { EChart } from '@/components/dashboard/EChart';
import { Card, Spinner } from '@/components/tailwind-ui';
import type { EChartsOption } from 'echarts';

export function ReportsOverviewSection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const overview = useFleetOverview(range);
  const trend = useTrend(range);

  if (overview.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" label={t('common.loading')} />
      </div>
    );
  }
  if (overview.isError) {
    return <ErrorState error={overview.error} onRetry={() => overview.refetch()} />;
  }
  const o = overview.data;
  if (!o) return <ErrorState error={new Error('no data')} onRetry={() => overview.refetch()} />;

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
        <Kpi title={t('reports.kpi.totalVehicles')} value={String(o.totalVehicles)} />
        <Kpi title={t('reports.kpi.withTelemetry')} value={String(o.vehiclesWithTelemetry)} />
        <Kpi title={t('reports.kpi.moving')} value={String(o.movingVehicles)} />
        <Kpi title={t('reports.kpi.idle')} value={String(o.idleVehicles)} />
        <Kpi title={t('reports.kpi.parked')} value={String(o.parkedVehicles)} />
        <Kpi title={t('reports.kpi.noTelemetry')} value={String(o.noTelemetryVehicles)} />
        <Kpi
          title={t('reports.kpi.distance')}
          value={
            o.totalDistanceKm >= 1000
              ? `${(o.totalDistanceKm / 1000).toFixed(1)}k km`
              : `${o.totalDistanceKm.toFixed(1)} km`
          }
        />
        <Kpi title={t('reports.kpi.trips')} value={String(o.totalTrips)} />
        <Kpi
          title={t('reports.kpi.alarms')}
          value={String(o.totalAlarms)}
          sub={`${o.openAlarms} ${t('reports.kpi.open')}`}
        />
        <Kpi title={t('reports.kpi.geofenceEvents')} value={String(o.geofenceEvents)} />
        <Kpi
          title={t('reports.kpi.utilization')}
          value={o.avgUtilizationPct === null ? '—' : `${o.avgUtilizationPct.toFixed(1)}%`}
          sub={o.avgUtilizationPct === null ? t('reports.noData') : undefined}
        />
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
              <EChart option={distanceTripsOption(trend.data?.points ?? [])} height={280} />
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
            <EChart option={alarmTrendOption(trend.data?.points ?? [])} height={280} />
          )}
        </ChartCard>
      </div>
      <ChartCard title={t('reports.charts.stateDistribution')}>
        <EChart option={distributionOption(o)} height={220} />
      </ChartCard>
    </div>
  );
}

function Kpi({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div
      data-testid="report-kpi"
      className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-white/5 dark:bg-graydark-300"
    >
      <p className="truncate text-xs text-gray-500 dark:text-graydark-600">{title}</p>
      <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-graydark-600">{sub}</p>}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card flush className="h-full p-4">
      <h3 className="mb-2 text-sm font-semibold text-gray-800 dark:text-white">{title}</h3>
      {children}
    </Card>
  );
}

function ChartLoading() {
  return (
    <div className="flex justify-center py-10">
      <Spinner size="md" />
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
): EChartsOption {
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['distance (km)', 'trips'] },
    xAxis: { type: 'category' as const, data: points.map((p) => p.day) },
    yAxis: [
      { type: 'value' as const, name: 'km' },
      { type: 'value' as const, name: 'trips' },
    ],
    series: [
      {
        name: 'distance (km)',
        type: 'line' as const,
        smooth: true,
        areaStyle: { opacity: 0.15 },
        data: points.map((p) => Number(p.distanceKm.toFixed(1))),
      },
      { name: 'trips', type: 'bar' as const, yAxisIndex: 1, data: points.map((p) => p.trips) },
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
): EChartsOption {
  const keys = ['alarmSpeeding', 'alarmGeofence', 'alarmOffline', 'alarmOther'] as const;
  const names = ['speeding', 'geofence', 'offline', 'other'];
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

function distributionOption(o: {
  movingVehicles: number;
  idleVehicles: number;
  parkedVehicles: number;
  noTelemetryVehicles: number;
}): EChartsOption {
  return {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [
      {
        type: 'pie' as const,
        radius: ['40%', '70%'],
        avoidLabelOverlap: true,
        data: [
          { name: 'moving', value: o.movingVehicles },
          { name: 'idle', value: o.idleVehicles },
          { name: 'parked', value: o.parkedVehicles },
          { name: 'no telemetry', value: o.noTelemetryVehicles },
        ],
      },
    ],
  };
}
