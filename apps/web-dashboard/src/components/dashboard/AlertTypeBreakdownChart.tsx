import type { EChartsOption } from 'echarts';
import { PieChart as PieChartIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveAlarms } from '@/api/fleet.api';
import { status } from '@/theme/palette';
import type { AlertType } from '@/types/fleet.types';

import { DashboardCard } from './DashboardCard';
import { EChart } from './EChart';

/** Alert type → semantic color (§0.2). */
const TYPE_COLOR: Record<AlertType, string> = {
  overspeed: status.red,
  fcw: status.purple,
  idle: status.amber,
  geofence: status.indigo,
  dtc: status.teal,
  lowBattery: status.slate,
};

/** Display order for the rose/donut — most-severe first. */
const TYPE_ORDER: AlertType[] = ['overspeed', 'fcw', 'idle', 'geofence', 'dtc', 'lowBattery'];

/**
 * AlertTypeBreakdownChart — rose/donut of active alerts grouped by type.
 *
 * Counts the REAL active-alarm feed (notification-service, via useActiveAlarms)
 * by category and renders an ECharts rose chart (radius scaled to count) so the
 * dominant alert types stand out at a glance. When the notification service is
 * unreachable the chart shows an honest error state (§22) — no fabricated data.
 */
export function AlertTypeBreakdownChart() {
  const { t } = useTranslation();
  const { data, isLoading, isError, error, refetch } = useActiveAlarms();
  const alerts = data ?? [];

  const option = useMemo(() => {
    const counts = new Map<AlertType, number>();
    for (const a of alerts) counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
    const series = TYPE_ORDER.filter((type) => counts.has(type)).map((type) => ({
      name: t(`dashboard.alerts.${type}`),
      value: counts.get(type) ?? 0,
      itemStyle: { color: TYPE_COLOR[type] },
    }));

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
          roseType: 'radius',
          radius: ['28%', '72%'],
          center: ['38%', '50%'],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 5, borderColor: 'transparent', borderWidth: 2 },
          label: { show: false },
          labelLine: { show: false },
          emphasis: { scale: true, scaleSize: 6 },
          data: series,
        },
      ],
    } as EChartsOption;
  }, [alerts, t]);

  return (
    <DashboardCard
      titleKey="dashboard.widgets.alertTypes"
      accent="purple"
      icon={PieChartIcon}
      loading={isLoading && !isError}
      empty={alerts.length === 0 && !isLoading && !isError}
      emptyKey="dashboard.empty.alerts"
      error={isError ? error : undefined}
      onRetry={() => void refetch()}
      flush
    >
      <div className="w-full px-4 pb-3">
        <EChart option={option} height={220} />
      </div>
    </DashboardCard>
  );
}
