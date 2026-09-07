import type { ApexOptions } from 'apexcharts';
import { TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type ReportPresetId, useTrend } from '@/api/report.api';
import { formatDate } from '@/lib/format-date';
import { formatNumber } from '@/lib/format-number';
import { chart } from '@/theme/palette';

import { ApexChart } from './ApexChart';
import { DashboardCard } from './DashboardCard';

const PRESETS: ReportPresetId[] = ['7d', '30d'];

/**
 * DistanceTrendChart — 7/30-day distance area chart from reporting-service.
 *
 * Same `GET /reports/trend` contract as TrendChartsRow; TanStack Query shares
 * the cache. No fabricated week-over-week percentages.
 */
export function DistanceTrendChart() {
  const { t, i18n } = useTranslation();
  const [preset, setPreset] = useState<ReportPresetId>('7d');
  const trend = useTrend({ preset });
  const points = useMemo(() => trend.data?.points ?? [], [trend.data]);
  const empty = !trend.isLoading && !trend.isError && points.length === 0;

  const categories = useMemo(
    () =>
      points.map((p) => {
        const d = new Date(`${p.day}T00:00:00.000Z`);
        if (Number.isNaN(d.getTime())) return p.day.slice(5);
        return formatDate(d, { month: 'short', day: 'numeric', timeZone: 'UTC' }, i18n.language);
      }),
    [points, i18n.language],
  );

  const totalKm = useMemo(() => points.reduce((sum, p) => sum + p.distanceKm, 0), [points]);

  const options = useMemo<ApexOptions>(
    () => ({
      colors: [chart.distance],
      legend: { show: false },
      xaxis: { categories },
      yaxis: {
        min: 0,
        forceNiceScale: true,
        decimalsInFloat: 0,
        labels: {
          formatter: (v: number) =>
            v >= 1000
              ? `${formatNumber(Math.round(v / 100) / 10, i18n.language)}k`
              : String(Math.round(v)),
        },
      },
      markers: { size: 4, strokeWidth: 0, hover: { size: 6 } },
      tooltip: {
        y: {
          formatter: (v: number) =>
            `${formatNumber(v, i18n.language, { maximumFractionDigits: 1 })} km`,
        },
      },
    }),
    [categories, i18n.language],
  );

  const presetSwitch = (
    <div className="flex items-center gap-1" data-testid="usage-preset-switch">
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
    <DashboardCard
      titleKey="dashboard.widgets.usageTrend"
      accent="brand"
      icon={TrendingUp}
      action={presetSwitch}
      loading={trend.isLoading && !trend.isError}
      empty={empty}
      emptyKey="reports.charts.empty"
      error={trend.isError ? trend.error : undefined}
      onRetry={() => void trend.refetch()}
      flush
    >
      <div className="flex items-baseline justify-between gap-2 px-4 sm:px-5">
        <p className="text-xs text-gray-500 dark:text-graydark-600">
          {formatNumber(Math.round(totalKm), i18n.language)} km · {t(`reports.range.${preset}`)}
        </p>
      </div>
      <div className="w-full px-2 pb-2 sm:px-3">
        <ApexChart
          type="area"
          series={[
            {
              name: t('dashboard.charts.distance'),
              data: points.map((p) => Number(p.distanceKm.toFixed(1))),
            },
          ]}
          options={options}
          height={220}
        />
      </div>
    </DashboardCard>
  );
}
