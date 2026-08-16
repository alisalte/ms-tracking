/**
 * ReportsOverviewSection — real fleet-overview KPI cards + trend charts
 * (Sprint J §6/§34/§35). Every number is the backend's documented KPI
 * (REPORTING-KPI-DEFINITIONS.md); charts render loading/empty/error states.
 */
import { useTranslation } from 'react-i18next';

import {
  useFleetOverview,
  useTrend,
  type ReportRange,
} from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { EChart } from '@/components/dashboard/EChart';
import type { EChartsOption } from 'echarts';
import { Box, Card, CardContent, CircularProgress, Stack, Typography } from '@mui/material';

export function ReportsOverviewSection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const overview = useFleetOverview(range);
  const trend = useTrend(range);

  if (overview.isLoading) {
    return (
      <Stack alignItems="center" sx={{ py: 8 }}>
        <CircularProgress />
      </Stack>
    );
  }
  if (overview.isError) {
    return <ErrorState error={overview.error} onRetry={() => overview.refetch()} />;
  }
  const o = overview.data;
  if (!o) return <ErrorState error={new Error('no data')} onRetry={() => overview.refetch()} />;

  return (
    <Stack gap={2}>
      <Typography variant="caption" color="text.secondary" data-testid="report-freshness">
        {t('reports.freshness', {
          freshness: o.freshness === 'NEAR_REALTIME' ? t('reports.freshnessNear') : t('reports.freshnessAgg'),
          asOf: new Date(o.dataAsOf).toLocaleTimeString(),
        })}
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 1.5 }}>
        <Kpi title={t('reports.kpi.totalVehicles')} value={String(o.totalVehicles)} />
        <Kpi title={t('reports.kpi.withTelemetry')} value={String(o.vehiclesWithTelemetry)} />
        <Kpi title={t('reports.kpi.moving')} value={String(o.movingVehicles)} />
        <Kpi title={t('reports.kpi.idle')} value={String(o.idleVehicles)} />
        <Kpi title={t('reports.kpi.parked')} value={String(o.parkedVehicles)} />
        <Kpi title={t('reports.kpi.noTelemetry')} value={String(o.noTelemetryVehicles)} />
        <Kpi title={t('reports.kpi.distance')} value={o.totalDistanceKm >= 1000 ? `${(o.totalDistanceKm / 1000).toFixed(1)}k km` : `${o.totalDistanceKm.toFixed(1)} km`} />
        <Kpi title={t('reports.kpi.trips')} value={String(o.totalTrips)} />
        <Kpi title={t('reports.kpi.alarms')} value={String(o.totalAlarms)} sub={`${o.openAlarms} ${t('reports.kpi.open')}`} />
        <Kpi title={t('reports.kpi.geofenceEvents')} value={String(o.geofenceEvents)} />
        <Kpi
          title={t('reports.kpi.utilization')}
          value={o.avgUtilizationPct === null ? '—' : `${o.avgUtilizationPct.toFixed(1)}%`}
          sub={o.avgUtilizationPct === null ? t('reports.noData') : undefined}
        />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' }, gap: 1.5 }}>
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
      </Box>
      <ChartCard title={t('reports.charts.stateDistribution')}>
        <EChart option={distributionOption(o)} height={220} />
      </ChartCard>
    </Stack>
  );
}


function Kpi({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <Card variant="outlined" data-testid="report-kpi">
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="caption" color="text.secondary" noWrap>
          {title}
        </Typography>
        <Typography variant="h5" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </Typography>
        {sub && (
          <Typography variant="caption" color="text.secondary">
            {sub}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
          {title}
        </Typography>
        {children}
      </CardContent>
    </Card>
  );
}

function ChartLoading() {
  return (
    <Stack alignItems="center" sx={{ py: 6 }}>
      <CircularProgress size={28} />
    </Stack>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <Stack alignItems="center" justifyContent="center" sx={{ height: 220 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  );
}

// ── ECharts options (theme handled by the shared EChart wrapper) ───────────

function distanceTripsOption(points: Array<{ day: string; distanceKm: number; trips: number }>): EChartsOption {
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

function alarmTrendOption(points: Array<{
  day: string;
  alarmSpeeding: number;
  alarmGeofence: number;
  alarmOffline: number;
  alarmOther: number;
}>): EChartsOption {
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

