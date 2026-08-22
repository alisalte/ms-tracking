import type { EChartsOption } from 'echarts';
import { useMemo } from 'react';

import { EChart } from '@/components/dashboard/EChart';
import { Skeleton } from '@/components/tailwind-ui';
import { useThemeContext } from '@/theme/ThemeRegistry';
import { status } from '@/theme/palette';
import type { TripWaypoint } from '@/types/fleet.types';

interface SpeedGraphProps {
  /** Ordered position samples; the chart plots each one's speed. */
  waypoints: TripWaypoint[];
  /** Speed limit (km/h) — a dashed reference line. */
  speedLimitKmh: number;
  /** Current replay index — the playhead the chart highlights. */
  index: number;
  loading?: boolean;
}

/** HH:MM label for a waypoint timestamp. */
function timeLabel(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * SpeedGraph — speed-over-time line chart for a trip (ECharts port).
 *
 * Plots `waypoint.speed` across the trip on the shared EChart wrapper (which
 * handles dark/light theming) with a dashed markLine at the speed limit, a
 * vertical markLine playhead that follows the replay index, and a highlighted
 * scatter dot on the current point. The axis tooltip shows time + km/h.
 */
export function SpeedGraph({ waypoints, speedLimitKmh, index, loading = false }: SpeedGraphProps) {
  const { mode } = useThemeContext();
  const isDark = mode === 'dark';

  const option = useMemo<EChartsOption>(() => {
    const labels = waypoints.map((w) => timeLabel(w.ts));
    const speeds = waypoints.map((w) => w.speed);
    // Match the EChart wrapper's theme-aware axis text tokens (the wrapper's
    // shallow merge replaces whole axes when a caller defines them).
    const axisColor = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(15,23,42,0.55)';
    const splitColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.05)';

    return {
      grid: { containLabel: true, left: 8, right: 16, top: 20, bottom: 8 },
      xAxis: {
        type: 'category',
        data: labels,
        boundaryGap: false,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: axisColor,
          fontSize: 11,
          // Thin the time labels (≈6 ticks regardless of sample count).
          interval: Math.max(0, Math.floor(waypoints.length / 6) - 1),
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: axisColor, fontSize: 11 },
        splitLine: { lineStyle: { color: splitColor, type: 'dashed' } },
      },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value) => `${value} km/h`,
      },
      series: [
        {
          type: 'line',
          data: speeds,
          smooth: 0.2,
          showSymbol: false,
          animation: false,
          lineStyle: { color: status.blue, width: 2 },
          itemStyle: { color: status.blue },
          markLine: {
            silent: true,
            symbol: 'none',
            data: [
              // Dashed reference at the speed limit, labeled with its value.
              {
                yAxis: speedLimitKmh,
                lineStyle: { color: status.red, type: 'dashed' },
                label: {
                  formatter: String(speedLimitKmh),
                  position: 'insideEndTop',
                  color: status.red,
                  fontSize: 10,
                },
              },
              // Vertical playhead following the current replay index.
              {
                xAxis: index,
                lineStyle: { color: status.green, width: 1, opacity: 0.6 },
                label: { show: false },
              },
            ],
          },
        },
        {
          // Highlight the current replay point with a larger green dot.
          type: 'scatter',
          data: speeds.map((s, i) => (i === index ? s : '-')),
          symbolSize: 10,
          itemStyle: { color: status.green, borderColor: '#FFFFFF', borderWidth: 2 },
          silent: true,
          z: 10,
        },
      ],
    };
  }, [waypoints, speedLimitKmh, index, isDark]);

  if (loading || waypoints.length === 0) {
    return <Skeleton className="h-60 w-full rounded-lg" />;
  }

  return <EChart option={option} height={240} />;
}
