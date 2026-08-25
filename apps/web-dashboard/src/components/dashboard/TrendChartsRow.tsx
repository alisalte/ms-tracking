import type { ApexOptions } from 'apexcharts';
import { BarChart3, Siren } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type ReportPresetId, useTrend } from '@/api/report.api';
import { status } from '@/theme/palette';

import { ApexChart } from './ApexChart';
import { DashboardCard } from './DashboardCard';

/** Trend presets offered on the dashboard (compact 7d/30d switch). */
const PRESETS: ReportPresetId[] = ['7d', '30d'];

/**
 * TrendChartsRow — daily distance/trips combo + stacked daily alarms, fed by
 * the reporting service's `GET /reports/trend` (Sprint J KPI formulas).
 */
export function TrendChartsRow() {
  const { t } = useTranslation();
  const [preset, setPreset] = useState<ReportPresetId>('7d');
  const trend = useTrend({ preset });
  const points = useMemo(() => trend.data?.points ?? [], [trend.data]);
  const empty = !trend.isLoading && !trend.isError && points.length === 0;
  const categories = useMemo(() => points.map((p) => p.day.slice(5)), [points]);

  const distanceTripsOptions = useMemo<ApexOptions>(
    () => ({
      chart: { stacked: false },
      colors: [status.blue, status.teal],
      stroke: { width: [3, 0] },
      fill: { type: ['gradient', 'solid'], opacity: [0.25, 1] },
      legend: { position: 'top', horizontalAlign: 'left' },
      xaxis: { categories },
      yaxis: [
        { title: { text: 'km' }, decimalsInFloat: 0 },
        { opposite: true, title: { text: t('dashboard.charts.trips') }, decimalsInFloat: 0 },
      ],
      plotOptions: { bar: { columnWidth: '42%', borderRadius: 3 } },
    }),
    [categories, t],
  );

  const distanceTripsSeries = useMemo(
    () => [
      {
        name: t('dashboard.charts.distance'),
        type: 'area' as const,
        data: points.map((p) => Number(p.distanceKm.toFixed(1))),
      },
      {
        name: t('dashboard.charts.trips'),
        type: 'column' as const,
        data: points.map((p) => p.trips),
      },
    ],
    [points, t],
  );

  const alarmBuckets = useMemo(
    () =>
      [
        { key: 'alarmSpeeding' as const, label: t('dashboard.charts.speeding'), color: status.red },
        {
          key: 'alarmGeofence' as const,
          label: t('dashboard.charts.geofence'),
          color: status.indigo,
        },
        {
          key: 'alarmOffline' as const,
          label: t('dashboard.charts.offline'),
          color: status.slate,
        },
        { key: 'alarmOther' as const, label: t('dashboard.charts.other'), color: status.amber },
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
      plotOptions: { bar: { columnWidth: '48%', borderRadius: 2 } },
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
              series={distanceTripsSeries}
              options={distanceTripsOptions}
              height={240}
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
