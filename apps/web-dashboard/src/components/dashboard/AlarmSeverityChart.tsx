import type { ApexOptions } from 'apexcharts';
import { Siren } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAlarmReport } from '@/api/report.api';
import { chart } from '@/theme/palette';

import { ApexChart } from './ApexChart';
import { DashboardCard } from './DashboardCard';

const RANGE = { preset: '7d' } as const;

/** Severity → palette color + display order. */
const SEVERITIES = [
  { key: 'critical' as const, color: chart.critical },
  { key: 'high' as const, color: chart.high },
  { key: 'medium' as const, color: chart.medium },
  { key: 'low' as const, color: chart.low },
  { key: 'info' as const, color: chart.info },
];

/**
 * AlarmSeverityChart — severity mix of the period's alarms (last 7 days).
 *
 * Donut of the reporting service's alarm summary with the total in the center.
 */
export function AlarmSeverityChart() {
  const { t } = useTranslation();
  const alarms = useAlarmReport(RANGE);
  const summary = alarms.data?.summary;
  const empty = !alarms.isLoading && !alarms.isError && (!summary || summary.total === 0);

  const slices = useMemo(() => {
    if (!summary || summary.total === 0) return [] as Array<{ label: string; value: number; color: string }>;
    return SEVERITIES.map((s) => ({
      label: t(`dashboard.severities.${s.key}`),
      value: summary[s.key],
      color: s.color,
    })).filter((d) => d.value > 0);
  }, [summary, t]);

  const options = useMemo<ApexOptions>(
    () => ({
      labels: slices.map((s) => s.label),
      colors: slices.map((s) => s.color),
      legend: { position: 'bottom' },
      plotOptions: {
        pie: {
          donut: {
            size: '70%',
            labels: {
              show: true,
              total: {
                show: true,
                label: t('dashboard.charts.totalAlarms'),
                formatter: () => (summary ? summary.total.toLocaleString() : '—'),
              },
            },
          },
        },
      },
    }),
    [slices, summary, t],
  );

  return (
    <DashboardCard
      titleKey="dashboard.widgets.alarmSeverity"
      icon={Siren}
      accent="warning"
      loading={alarms.isLoading && !alarms.isError}
      empty={empty}
      emptyKey="reports.charts.empty"
      error={alarms.isError ? alarms.error : undefined}
      onRetry={() => void alarms.refetch()}
      flush
    >
      <div className="w-full px-4 sm:px-5">
        <ApexChart type="donut" series={slices.map((s) => s.value)} options={options} height={230} />
        {summary && summary.total > 0 && (
          <div className="flex items-center justify-center gap-2 pb-3">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-danger-500/10 px-2.5 py-1 text-[0.7rem] font-bold text-danger-600 tabular-nums dark:text-danger-400">
              <span className="size-1.5 rounded-full bg-danger-500 motion-safe:animate-pulse" />
              {t('dashboard.stats.critical', { count: summary.critical })}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-warning-500/10 px-2.5 py-1 text-[0.7rem] font-bold text-warning-600 tabular-nums dark:text-warning-400">
              {t('dashboard.stats.activeAlarms')}: {summary.open}
            </span>
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
