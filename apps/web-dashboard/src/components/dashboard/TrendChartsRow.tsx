import type { ApexOptions } from 'apexcharts';
import { BarChart3, Siren } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type ReportPresetId, useTrend } from '@/api/report.api';
import { chart } from '@/theme/palette';

import { ApexChart } from './ApexChart';
import { DashboardCard } from './DashboardCard';
import { mixedDistanceTrips } from './distance-trips-mixed';

/** Trend presets offered on the dashboard (compact 7d/30d switch). */
const PRESETS: ReportPresetId[] = ['7d', '30d'];

/**
 * TrendChartsRow — daily distance/trips combo + stacked daily alarms, fed by
 * the reporting service's `GET /reports/trend` (Sprint J KPI formulas).
 */
export function TrendChartsRow() {
  const { t, i18n } = useTranslation();
  const [preset, setPreset] = useState<ReportPresetId>('7d');
  const trend = useTrend({ preset });
  const points = useMemo(() => trend.data?.points ?? [], [trend.data]);
  const empty = !trend.isLoading && !trend.isError && points.length === 0;
  const categories = useMemo(() => points.map((p) => p.day.slice(5)), [points]);

  const mixed = useMemo(
    () =>
      mixedDistanceTrips(
        points,
        {
          distance: t('dashboard.charts.distance'),
          trips: t('dashboard.charts.trips'),
        },
        i18n.language,
      ),
    [points, t, i18n.language],
  );

  const alarmBuckets = useMemo(
    () =>
      [
        { key: 'alarmSpeeding' as const, label: t('dashboard.charts.speeding'), color: chart.speeding },
        {
          key: 'alarmGeofence' as const,
          label: t('dashboard.charts.geofence'),
          color: chart.geofence,
        },
        {
          key: 'alarmOffline' as const,
          label: t('dashboard.charts.offline'),
          color: chart.offline,
        },
        { key: 'alarmOther' as const, label: t('dashboard.charts.other'), color: chart.other },
      ] as const,
    [t],
  );

  const alarmOptions = useMemo<ApexOptions>(
    () => ({
      chart: { stacked: true },
      colors: alarmBuckets.map((b) => b.color),
      legend: { position: 'top', horizontalAlign: 'left' },
      xaxis: { categories },
      yaxis: { decimalsInFloat: 0 },
      plotOptions: { bar: { columnWidth: '48%', borderRadius: 4 } },
      fill: { opacity: 1 },
    }),
    [alarmBuckets, categories],
  );

  const alarmSeries = useMemo(
    () =>
      alarmBuckets.map((b) => ({
        name: b.label,
        data: points.map((p) => p[b.key]),
      })),
    [alarmBuckets, points],
  );

  const presetSwitch = (
    <div className="flex items-center gap-1" data-testid="trend-preset-switch">
      {PRESETS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => setPreset(p)}
          aria-pressed={preset === p}
          className={`rounded-md px-2 py-0.5 text-xs font-semibold transition-colors ${
            preset === p
              ? 'bg-brand-600 text-white'
              : 'text-gray-500 hover:bg-gray-100 dark:text-graydark-700 dark:hover:bg-white/5'
          }`}
        >
          {t(`reports.range.${p}`)}
        </button>
      ))}
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="lg:col-span-8">
        <DashboardCard
          titleKey="dashboard.widgets.distanceTripsTrend"
          accent="brand"
          icon={BarChart3}
          action={presetSwitch}
          loading={trend.isLoading && !trend.isError}
          empty={empty}
          emptyKey="reports.charts.empty"
          error={trend.isError ? trend.error : undefined}
          onRetry={() => void trend.refetch()}
          flush
        >
          <div className="w-full px-4 pb-3 sm:px-5">
            <ApexChart
              type="line"
              series={mixed.series}
              options={mixed.options}
              height={300}
            />
          </div>
        </DashboardCard>
      </div>
      <div className="lg:col-span-4">
        <DashboardCard
          titleKey="dashboard.widgets.alarmTrend"
          accent="danger"
          icon={Siren}
          loading={trend.isLoading && !trend.isError}
          empty={empty}
          emptyKey="reports.charts.empty"
          error={trend.isError ? trend.error : undefined}
          onRetry={() => void trend.refetch()}
          flush
        >
          <div className="w-full px-4 pb-3 sm:px-5">
            <ApexChart type="bar" series={alarmSeries} options={alarmOptions} height={240} />
          </div>
        </DashboardCard>
      </div>
    </div>
  );
}
