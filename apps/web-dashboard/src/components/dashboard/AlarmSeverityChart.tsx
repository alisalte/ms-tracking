import type { EChartsOption } from 'echarts';
import { Siren } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAlarmReport } from '@/api/report.api';
import { status } from '@/theme/palette';

import { DashboardCard } from './DashboardCard';
import { EChart } from './EChart';

const RANGE = { preset: '7d' } as const;

/** Severity → palette color + display order. */
const SEVERITIES = [
  { key: 'critical', color: status.danger, deep: status.dangerDeep },
  { key: 'high', color: status.dangerLight },
  { key: 'medium', color: status.warning },
  { key: 'low', color: status.infoLight },
  { key: 'info', color: status.slate },
] as const;

/**
 * AlarmSeverityChart — severity mix of the period's alarms (last 7 days).
 *
 * Donut of the reporting service's alarm summary (`GET /reports/alarms`
 * summary: critical/high/medium/low/info) with the total in the center and
 * open-alarm context in the footer chips.
 */
export function AlarmSeverityChart() {
  const { t } = useTranslation();
  const alarms = useAlarmReport(RANGE);
  const summary = alarms.data?.summary;
  const empty = !alarms.isLoading && !alarms.isError && (!summary || summary.total === 0);

  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: {
        trigger: 'item',
        formatter: (p) => {
          const item = p as { name?: string; value?: number; percent?: number };
          return `<b>${item.name}</b><br/>${item.value} (${item.percent}%)`;
        },
      },
      legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11 } },
      title: {
        text: summary ? summary.total.toLocaleString() : '—',
        subtext: t('dashboard.charts.totalAlarms'),
        left: 'center',
        top: '38%',
        textStyle: { fontSize: 24, fontWeight: 900 },
        subtextStyle: { fontSize: 11 },
      },
      series: [
        {
          type: 'pie',
          radius: ['52%', '76%'],
          center: ['50%', '44%'],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 5, borderWidth: 2, borderColor: 'transparent' },
          label: { show: false },
          emphasis: { scaleSize: 6 },
          data:
            summary && summary.total > 0
              ? SEVERITIES.map((s) => ({
                  name: t(`dashboard.severities.${s.key}`),
                  value: summary[s.key],
                  itemStyle: { color: s.color },
                })).filter((d) => d.value > 0)
              : [],
        },
      ],
    }),
    [summary, t],
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
        <EChart option={option} height={230} />
        {summary && summary.total > 0 && (
          <div className="flex items-center justify-center gap-2 pb-3">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-danger-500/10 px-2.5 py-1 text-[0.7rem] font-bold text-danger-600 dark:text-danger-400 tabular-nums">
              <span className="size-1.5 rounded-full bg-danger-500 motion-safe:animate-pulse" />
              {t('dashboard.stats.critical', { count: summary.critical })}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-warning-500/10 px-2.5 py-1 text-[0.7rem] font-bold text-warning-600 dark:text-warning-400 tabular-nums">
              {t('dashboard.stats.activeAlarms')}: {summary.open}
            </span>
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
