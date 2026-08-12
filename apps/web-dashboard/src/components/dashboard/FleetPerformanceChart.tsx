import type { EChartsOption } from 'echarts';
import { BarChart3 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTrips } from '@/api/fleet.api';
import { useThemeContext } from '@/theme/ThemeRegistry';
import { primary, status } from '@/theme/palette';

import { EChart } from './EChart';
import { WidgetCard } from './WidgetCard';

/** Number of top vehicles to rank. */
const TOP_N = 6;

/**
 * FleetPerformanceChart — top vehicles by distance driven (ECharts).
 *
 * Aggregates completed/in-progress trip distance per vehicle from the trips
 * feed and ranks the top N as a rounded horizontal bar chart. Uses a brand
 * gradient matching the indigo primary so it reads as "performance/positive".
 * Y-axis categories are reversed so the highest performer sits at the top.
 *
 * Tailwind shell; aggregation logic + `useTrips()` hook unchanged.
 */
export function FleetPerformanceChart() {
  const { t: _t } = useTranslation();
  const { mode } = useThemeContext();
  const { data, isLoading } = useTrips();
  const trips = data ?? [];

  const labelColor = mode === 'dark' ? '#9AA5B5' : '#667085';

  const option = useMemo(() => {
    // Aggregate distance by vehicle label.
    const totals = new Map<string, number>();
    for (const trip of trips) {
      totals.set(trip.vehicleLabel, (totals.get(trip.vehicleLabel) ?? 0) + trip.distanceKm);
    }
    const ranked = [...totals.entries()]
      .map(([label, km]) => ({ label, km: Math.round(km) }))
      .sort((a, b) => b.km - a.km)
      .slice(0, TOP_N)
      .reverse(); // reverse so ECharts renders the highest at the top

    const max = Math.max(1, ...ranked.map((r) => r.km));
    return {
      grid: { left: 8, right: 32, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: Array<{ name: string; value: number }>) =>
          `${params[0]?.name ?? ''}: ${params[0]?.value ?? 0} km`,
      },
      xAxis: { type: 'value', max: Math.ceil(max * 1.1), show: false },
      yAxis: {
        type: 'category',
        data: ranked.map((r) => r.label),
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: ranked.map((r, i) => ({
            value: r.km,
            itemStyle: {
              borderRadius: 6,
              // Highlight the #1 in the success green, others in the brand indigo.
              color:
                i === ranked.length - 1
                  ? {
                      type: 'linear',
                      x: 0,
                      y: 0,
                      x2: 1,
                      y2: 0,
                      colorStops: [
                        { offset: 0, color: `${status.success}CC` },
                        { offset: 1, color: status.success },
                      ],
                    }
                  : {
                      type: 'linear',
                      x: 0,
                      y: 0,
                      x2: 1,
                      y2: 0,
                      colorStops: [
                        { offset: 0, color: `${primary.main}CC` },
                        { offset: 1, color: primary.main },
                      ],
                    },
            },
          })),
          barWidth: 14,
          label: {
            show: true,
            position: 'right',
            formatter: '{c} km',
            fontSize: 11,
            fontWeight: 600,
            color: labelColor,
          },
        },
      ],
    } as EChartsOption;
  }, [trips, labelColor]);

  return (
    <WidgetCard
      titleKey="dashboard.widgets.performance"
      icon={BarChart3}
      loading={isLoading}
      empty={trips.length === 0 && !isLoading}
      emptyKey="dashboard.empty.performance"
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
