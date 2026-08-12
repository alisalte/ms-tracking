import type { EChartsOption } from 'echarts';
import { PieChart as PieChartIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveAlerts } from '@/api/fleet.api';
import { useThemeContext } from '@/theme/ThemeRegistry';
import { status } from '@/theme/palette';
import type { AlertType } from '@/types/fleet.types';

import { EChart } from './EChart';
import { WidgetCard } from './WidgetCard';

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
 * Counts the live active-alert feed by category and renders an ECharts rose
 * chart (radius scaled to count) so the dominant alert types stand out at a
 * glance. Colors map to the semantic status tokens so the panel reads
 * consistently with the Active Alerts feed and the KPI cards.
 *
 * Tailwind shell; aggregation + ECharts option unchanged.
 */
export function AlertTypeBreakdownChart() {
  const { t } = useTranslation();
  const { mode } = useThemeContext();
  const { data, isLoading } = useActiveAlerts();
  const alerts = data ?? [];

  const legendColor = mode === 'dark' ? '#9AA5B5' : '#475467';

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
        textStyle: { fontSize: 11, color: legendColor },
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
  }, [alerts, t, legendColor]);

  return (
    <WidgetCard
      titleKey="dashboard.widgets.alertTypes"
      icon={PieChartIcon}
      loading={isLoading}
      empty={alerts.length === 0 && !isLoading}
      emptyKey="dashboard.empty.alerts"
    >
      <div className="h-[220px] w-full">
        {isLoading ? (
          <div className="h-full w-full animate-pulse rounded-lg bg-gray-100 dark:bg-white/5" />
        ) : (
          <EChart option={option} height={220} />
        )}
      </div>
    </WidgetCard>
  );
}
