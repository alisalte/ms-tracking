import type { EChartsOption } from 'echarts';
import { BarChart3, Siren } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type ReportPresetId, useTrend } from '@/api/report.api';
import { status } from '@/theme/palette';

import { DashboardCard } from './DashboardCard';
import { EChart } from './EChart';

/** Trend presets offered on the dashboard (compact 7d/30d switch). */
const PRESETS: ReportPresetId[] = ['7d', '30d'];

/**
 * TrendChartsRow — daily distance/trips combo + stacked daily alarms, fed by
 * the reporting service's `GET /reports/trend` (Sprint J §13 formulas).
 *
 * The left card pairs a smoothed distance line (km, left axis) with trip bars
 * (right axis); the right card stacks the trend's alarm buckets
 * (speeding/geofence/offline/other). A compact preset switch (7d/30d) drives
 * both queries. Rendered only for users holding `report.read`.
 */
export function TrendChartsRow() {
  const { t } = useTranslation();
  const [preset, setPreset] = useState<ReportPresetId>('7d');
  const trend = useTrend({ preset });
  const points = useMemo(() => trend.data?.points ?? [], [trend.data]);
  const empty = !trend.isLoading && !trend.isError && points.length === 0;

  const distanceTripsOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { trigger: 'axis' },
      legend: { data: [t('dashboard.charts.distance'), t('dashboard.charts.trips')], top: 0 },
      grid: { left: 8, right: 8, top: 32, bottom: 0, containLabel: true },
      xAxis: { type: 'category', data: points.map((p) => p.day.slice(5)) },
      yAxis: [
        { type: 'value', name: 'km', splitNumber: 4 },
        { type: 'value', name: t('dashboard.charts.trips'), splitNumber: 4 },
      ],
      series: [
        {
          name: t('dashboard.charts.distance'),
          type: 'line',
          smooth: true,
          symbolSize: 4,
          areaStyle: { opacity: 0.15 },
          itemStyle: { color: status.blue },
          data: points.map((p) => Number(p.distanceKm.toFixed(1))),
        },
        {
          name: t('dashboard.charts.trips'),
          type: 'bar',
          yAxisIndex: 1,
          barMaxWidth: 18,
          itemStyle: { color: status.teal, borderRadius: [3, 3, 0, 0] },
          data: points.map((p) => p.trips),
        },
      ],
    }),
    [points, t],
  );

  const alarmTrendOption = useMemo<EChartsOption>(() => {
    const buckets = [
      { key: 'alarmSpeeding', label: t('dashboard.charts.speeding'), color: status.red },
      { key: 'alarmGeofence', label: t('dashboard.charts.geofence'), color: status.indigo },
      { key: 'alarmOffline', label: t('dashboard.charts.offline'), color: status.slate },
      { key: 'alarmOther', label: t('dashboard.charts.other'), color: status.amber },
    ] as const;
    return {
      tooltip: { trigger: 'axis' },
      legend: { top: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { fontSize: 11 } },
      grid: { left: 8, right: 8, top: 32, bottom: 0, containLabel: true },
      xAxis: { type: 'category', data: points.map((p) => p.day.slice(5)) },
      yAxis: { type: 'value', splitNumber: 4 },
      series: buckets.map((b) => ({
        name: b.label,
        type: 'bar' as const,
        stack: 'alarms',
        barMaxWidth: 18,
        itemStyle: { color: b.color },
        data: points.map((p) => p[b.key]),
      })),
    };
  }, [points, t]);

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
            <EChart option={distanceTripsOption} height={240} />
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
            <EChart option={alarmTrendOption} height={240} />
          </div>
        </DashboardCard>
      </div>
    </div>
  );
}
