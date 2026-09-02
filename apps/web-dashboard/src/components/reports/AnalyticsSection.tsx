/**
 * AnalyticsSection — executive KPI scorecard, safety indicators, and fleet
 * comparison (Reporting.md §1.3). Every number is a backend KPI; deltas are
 * the equal-length previous window (never a fabricated target).
 */
import {
  AlertTriangle,
  Fence,
  Gauge,
  Layers,
  Route,
  Shield,
  Timer,
  TrendingUp,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  type FleetComparisonRowWire,
  type KpiIndicatorWire,
  type ReportRange,
  useFleetComparison,
  useKpiScorecard,
  useSafetyScorecard,
} from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { ApexChart } from '@/components/dashboard/ApexChart';
import { KpiChip, KpiTile } from '@/components/dashboard/KpiTile';
import { type Column, ReportsTable } from '@/components/reports/ReportsTable';
import { Card, CardHeader, EmptyState, Skeleton } from '@/components/tailwind-ui';
import { chart } from '@/theme/palette';
import type { ApexOptions } from 'apexcharts';

const DOWN_IS_GOOD = new Set([
  'alarms',
  'openAlarms',
  'speedingEvents',
  'geofenceEvents',
  'idleHours',
  'totalAlarms',
  'highSeverityAlarms',
]);

export function AnalyticsSection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const kpis = useKpiScorecard(range);
  const safety = useSafetyScorecard(range);
  const fleets = useFleetComparison(range);

  if (kpis.isLoading && safety.isLoading && fleets.isLoading) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: role=status loading region.
      <div className="flex flex-col gap-4" role="status" aria-label={t('common.loading')}>
        <Skeleton className="h-4 w-64" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows never reorder.
            <Skeleton key={`k-${i}`} className="h-[104px] rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-[280px] rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-white">
          {t('reports.analytics.kpiTitle')}
        </h2>
        <p className="text-xs text-gray-500 dark:text-graydark-600">
          {t('reports.analytics.kpiNote')}
        </p>
        {kpis.isError ? (
          <ErrorState error={kpis.error} onRetry={() => kpis.refetch()} />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="report-kpi-scorecard">
            {(kpis.data?.current.indicators ?? []).map((ind) => (
              <KpiIndicatorTile key={ind.key} indicator={ind} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-white">
          {t('reports.analytics.safetyTitle')}
        </h2>
        {safety.isError ? (
          <ErrorState error={safety.error} onRetry={() => safety.refetch()} />
        ) : safety.data ? (
          <SafetyRow data={safety.data.current} />
        ) : (
          <Skeleton className="h-[104px] rounded-2xl" />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-white">
          {t('reports.analytics.fleetTitle')}
        </h2>
        {fleets.isError ? (
          <ErrorState error={fleets.error} onRetry={() => fleets.refetch()} />
        ) : fleets.isLoading ? (
          <Skeleton className="h-[280px] rounded-2xl" />
        ) : (fleets.data?.items.length ?? 0) === 0 ? (
          <Card flush className="p-2">
            <EmptyState icon={<Layers />} title={t('reports.empty')} />
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader title={t('reports.charts.fleetComparison')} />
              <ApexChart
                type="bar"
                series={fleetBarSeries(fleets.data?.items ?? [], t)}
                options={fleetBarOptions(fleets.data?.items ?? [], t)}
                height={260}
              />
            </Card>
            <FleetComparisonTable rows={fleets.data?.items ?? []} />
          </>
        )}
      </section>
    </div>
  );
}

function KpiIndicatorTile({ indicator }: { indicator: KpiIndicatorWire }) {
  const icon =
    indicator.key === 'distanceKm'
      ? Route
      : indicator.key === 'utilizationPct'
        ? TrendingUp
        : indicator.key === 'avgSpeedKmh'
          ? Gauge
          : indicator.key === 'movingHours' || indicator.key === 'idleHours'
            ? Timer
            : indicator.key.includes('alarm') || indicator.key === 'speedingEvents'
              ? AlertTriangle
              : indicator.key === 'geofenceEvents'
                ? Fence
                : Shield;
  const formatted = formatIndicator(indicator);
  return (
    <div data-testid="report-kpi">
      <KpiTile
        labelKey={`reports.analytics.indicator.${indicator.key}`}
        value={formatted.value}
        suffix={formatted.suffix}
        icon={icon}
        tone={tileTone(indicator)}
        footer={
          <DeltaChip deltaPct={indicator.deltaPct} invert={DOWN_IS_GOOD.has(indicator.key)} />
        }
      />
    </div>
  );
}

function SafetyRow({
  data,
}: {
  data: {
    totalAlarms: number;
    openAlarms: number;
    speedingEvents: number;
    highSeverityAlarms: number;
    geofenceEvents: number;
    previous: {
      totalAlarms: number;
      openAlarms: number;
      speedingEvents: number;
      highSeverityAlarms: number;
      geofenceEvents: number;
    };
  };
}) {
  const items: Array<{ key: string; value: number; prev: number; icon: typeof Shield }> = [
    {
      key: 'totalAlarms',
      value: data.totalAlarms,
      prev: data.previous.totalAlarms,
      icon: AlertTriangle,
    },
    {
      key: 'openAlarms',
      value: data.openAlarms,
      prev: data.previous.openAlarms,
      icon: AlertTriangle,
    },
    {
      key: 'speedingEvents',
      value: data.speedingEvents,
      prev: data.previous.speedingEvents,
      icon: Gauge,
    },
    {
      key: 'highSeverityAlarms',
      value: data.highSeverityAlarms,
      prev: data.previous.highSeverityAlarms,
      icon: Shield,
    },
    {
      key: 'geofenceEvents',
      value: data.geofenceEvents,
      prev: data.previous.geofenceEvents,
      icon: Fence,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="report-safety-scorecard">
      {items.map((it) => {
        const delta = it.prev === 0 ? null : ((it.value - it.prev) / Math.abs(it.prev)) * 100;
        return (
          <KpiTile
            key={it.key}
            labelKey={`reports.analytics.safety.${it.key}`}
            value={it.value}
            icon={it.icon}
            tone={it.value > 0 ? 'danger' : 'success'}
            footer={<DeltaChip deltaPct={delta} invert />}
          />
        );
      })}
    </div>
  );
}

function FleetComparisonTable({ rows }: { rows: FleetComparisonRowWire[] }) {
  const columns: Column<FleetComparisonRowWire>[] = [
    { id: 'fleet', headerKey: 'reports.cols.fleet', render: (r) => r.fleetName },
    { id: 'vehicles', headerKey: 'reports.kpi.totalVehicles', render: (r) => r.vehicleCount },
    {
      id: 'distance',
      headerKey: 'reports.cols.distance',
      render: (r) => `${Math.round(r.distanceKm * 10) / 10} km`,
    },
    { id: 'trips', headerKey: 'reports.cols.trips', render: (r) => r.trips },
    {
      id: 'util',
      headerKey: 'reports.cols.utilization',
      render: (r) =>
        r.utilizationPct === null ? '—' : `${Math.round(r.utilizationPct * 10) / 10}%`,
    },
    { id: 'alarms', headerKey: 'reports.cols.total', render: (r) => r.alarms },
  ];
  return <ReportsTable rows={rows} columns={columns} rowKey={(r) => r.fleetId ?? r.fleetName} />;
}

function DeltaChip({ deltaPct, invert = false }: { deltaPct: number | null; invert?: boolean }) {
  const { t } = useTranslation();
  if (deltaPct === null) {
    return <KpiChip tone="gray">{t('reports.analytics.noDelta')}</KpiChip>;
  }
  const up = deltaPct > 0;
  const good = invert ? !up : up;
  const sign = up ? '+' : '';
  return (
    <KpiChip tone={good ? 'success' : 'danger'}>
      {sign}
      {deltaPct.toFixed(1)}%
    </KpiChip>
  );
}

function formatIndicator(ind: KpiIndicatorWire): { value: number | null; suffix: string } {
  if (ind.value === null) return { value: null, suffix: '' };
  switch (ind.unit) {
    case 'km':
      return { value: Math.round(ind.value * 10) / 10, suffix: ' km' };
    case 'pct':
      return { value: Math.round(ind.value * 10) / 10, suffix: '%' };
    case 'kmh':
      return { value: Math.round(ind.value), suffix: ' km/h' };
    case 'hours':
      return { value: Math.round(ind.value * 10) / 10, suffix: 'h' };
    default:
      return { value: Math.round(ind.value), suffix: '' };
  }
}

function tileTone(
  ind: KpiIndicatorWire,
): 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'gray' {
  if (ind.value === null) return 'gray';
  if (DOWN_IS_GOOD.has(ind.key)) return ind.value > 0 ? 'warning' : 'success';
  return 'brand';
}

function fleetBarSeries(rows: FleetComparisonRowWire[], t: (k: string) => string) {
  return [
    { name: t('reports.labels.distance'), data: rows.map((r) => Number(r.distanceKm.toFixed(1))) },
    { name: t('reports.labels.trips'), data: rows.map((r) => r.trips) },
  ];
}

function fleetBarOptions(rows: FleetComparisonRowWire[], t: (k: string) => string): ApexOptions {
  return {
    colors: [chart.distance, chart.trips],
    plotOptions: { bar: { columnWidth: '48%', borderRadius: 6 } },
    xaxis: { categories: rows.map((r) => r.fleetName) },
    yaxis: [
      { title: { text: t('reports.labels.km') }, decimalsInFloat: 1 },
      { opposite: true, title: { text: t('reports.labels.trips') }, decimalsInFloat: 0 },
    ],
  };
}
