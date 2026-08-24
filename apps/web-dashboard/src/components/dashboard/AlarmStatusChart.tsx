import type { EChartsOption } from 'echarts';
import { BellRing } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAlarmReport } from '@/api/report.api';
import { status } from '@/theme/palette';

import { DashboardCard } from './DashboardCard';
import { EChart } from './EChart';

const RANGE = { preset: '7d' } as const;

/** Status slice → semantic color (§0.2). */
const STATUS_COLOR = {
  open: status.red,
  acknowledged: status.amber,
  resolved: status.green,
} as const;

/** Severity bars — ordered most-severe first. */
const SEVERITY_LEVELS = [
  { key: 'critical', color: status.red },
  { key: 'high', color: status.warning },
  { key: 'medium', color: status.amber },
  { key: 'low', color: status.blue },
  { key: 'info', color: status.slate },
] as const;

/**
 * AlarmStatusChart — alarm lifecycle donut + severity breakdown (last 7 days).
 *
 * Left: ECharts donut of the reporting summary's open/acknowledged/resolved
 * counts. Right: per-severity mini bars (critical…info) as labeled Tailwind
 * meters. All from `GET /reports/alarms` (summary block) — no client-side
 * fabrication. Rendered only for users holding `report.read`.
 */
export function AlarmStatusChart() {
  const { t } = useTranslation();
  const report = useAlarmReport(RANGE);
  const summary = report.data?.summary;

  const option = useMemo(() => {
    const s = summary ?? { open: 0, acknowledged: 0, resolved: 0 };
    return {
      tooltip: {
        trigger: 'item',
        formatter: (p: { name: string; value: number; percent: number }) =>
          `${p.name}: ${p.value} (${p.percent}%)`,
      },
      legend: {
        orient: 'vertical',
        right: 0,
        top: 'center',
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { fontSize: 11 },
      },
      series: [
        {
          type: 'pie',
          radius: ['58%', '80%'],
          center: ['36%', '50%'],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 4, borderColor: 'transparent', borderWidth: 2 },
          label: { show: false },
          labelLine: { show: false },
          emphasis: { scale: true, scaleSize: 4 },
          data: (Object.keys(STATUS_COLOR) as Array<keyof typeof STATUS_COLOR>).map((k) => ({
            name: t(`dashboard.charts.${k}`),
            value: s[k],
            itemStyle: { color: STATUS_COLOR[k] },
          })),
        },
      ],
    } as EChartsOption;
  }, [summary, t]);

  const total = summary?.total ?? 0;

  return (
    <DashboardCard
      titleKey="dashboard.widgets.alarmStatus"
      accent="warning"
      icon={BellRing}
      loading={report.isLoading && !report.isError}
      empty={!report.isLoading && !report.isError && total === 0}
      emptyKey="dashboard.empty.alerts"
      error={report.isError ? report.error : undefined}
      onRetry={() => void report.refetch()}
      flush
    >
      <div className="flex w-full flex-col gap-2 px-4 pb-3 sm:px-5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <EChart option={option} height={220} />
        </div>
        <div className="flex shrink-0 flex-col gap-2.5 sm:w-40">
          {SEVERITY_LEVELS.map(({ key, color }) => {
            const value = summary?.[key] ?? 0;
            const pct = total > 0 ? Math.round((value / total) * 100) : 0;
            return (
              <div key={key} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-graydark-700">
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    {t(`dashboard.charts.${key}`)}
                  </span>
                  <span className="text-xs font-semibold tabular-nums text-gray-900 dark:text-white">
                    {value.toLocaleString()}
                  </span>
                </div>
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10"
                  role="progressbar"
                  tabIndex={0}
                  aria-label={t(`dashboard.charts.${key}`)}
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full transition-[width] duration-300"
                    style={{ width: `${pct}%`, backgroundColor: color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </DashboardCard>
  );
}
