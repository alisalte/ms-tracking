import type { ApexOptions } from 'apexcharts';
import { BellRing } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAlarmReport } from '@/api/report.api';
import { chart } from '@/theme/palette';

import { ApexChart } from './ApexChart';
import { DashboardCard } from './DashboardCard';

const RANGE = { preset: '7d' } as const;

/** Status slice → semantic color (§0.2). */
const STATUS_COLOR = {
  open: chart.open,
  acknowledged: chart.acknowledged,
  resolved: chart.resolved,
} as const;

/** Severity bars — ordered most-severe first. */
const SEVERITY_LEVELS = [
  { key: 'critical' as const, color: chart.critical },
  { key: 'high' as const, color: chart.high },
  { key: 'medium' as const, color: chart.medium },
  { key: 'low' as const, color: chart.low },
  { key: 'info' as const, color: chart.info },
];

/**
 * AlarmStatusChart — alarm lifecycle donut + severity breakdown (last 7 days).
 *
 * Left: donut of open/acknowledged/resolved. Right: per-severity meters.
 * All from `GET /reports/alarms` summary — no client-side fabrication.
 */
export function AlarmStatusChart() {
  const { t } = useTranslation();
  const report = useAlarmReport(RANGE);
  const summary = report.data?.summary;

  const slices = useMemo(() => {
    const s = summary ?? { open: 0, acknowledged: 0, resolved: 0 };
    return (Object.keys(STATUS_COLOR) as Array<keyof typeof STATUS_COLOR>).map((k) => ({
      label: t(`dashboard.charts.${k}`),
      value: s[k],
      color: STATUS_COLOR[k],
    }));
  }, [summary, t]);

  const options = useMemo<ApexOptions>(
    () => ({
      labels: slices.map((s) => s.label),
      colors: slices.map((s) => s.color),
      legend: { position: 'right', offsetY: 20 },
      plotOptions: {
        pie: {
          donut: {
            size: '68%',
            labels: { show: false },
          },
        },
      },
    }),
    [slices],
  );

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
      <div className="flex w-full flex-col gap-2 px-4 pb-3 sm:flex-row sm:items-center sm:px-5">
        <div className="min-w-0 flex-1">
          <ApexChart
            type="donut"
            series={slices.map((s) => s.value)}
            options={options}
            height={220}
          />
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
