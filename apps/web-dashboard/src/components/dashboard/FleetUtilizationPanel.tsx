<<<<<<< HEAD
=======
import { Box, Skeleton, Stack } from '@mui/material';
>>>>>>> 5bdd11003cc6ed2a06307b253ebd40c49da3ea6e
import type { EChartsOption } from 'echarts';
import { GaugeCircle } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFleetUtilization } from '@/api/fleet.api';
import { useThemeContext } from '@/theme/ThemeRegistry';
import { status } from '@/theme/palette';
import type { VehicleState } from '@/types/fleet.types';

import { EChart } from './EChart';
import { WidgetCard } from './WidgetCard';

/** State → semantic color (§0.2): green driving, amber idle, slate stopped/offline. */
const STATE_COLOR: Record<VehicleState, string> = {
  driving: status.green,
  idle: status.amber,
  stopped: status.slate,
  offline: '#94A3B8',
};

/**
 * FleetUtilizationPanel — donut + horizontal bars (ECharts).
 *
 * UI_UX_Design.md §1.4: a donut with the headline utilization % in the center
 * and horizontal bars showing time-in-state breakdown (driving / idle / stopped
 * / offline).
 *
 * Tailwind shell; ECharts options + `useFleetUtilization()` hook unchanged
 * except text colors now resolve explicitly from the active theme mode so the
 * chart reads correctly without depending on MUI's injected CSS variables.
 */
export function FleetUtilizationPanel() {
  const { t } = useTranslation();
  const { mode } = useThemeContext();
  const { data, isLoading } = useFleetUtilization();

  const textColor = mode === 'dark' ? '#E1E6EA' : '#101828';
  const subColor = mode === 'dark' ? '#9AA5B5' : '#667085';

  const donutOption = useMemo(() => {
    if (!data) return null;
    return {
      tooltip: {
        trigger: 'item',
        formatter: (p: { name: string; value: number; percent: number }) =>
          `${p.name}: ${p.value}%`,
      },
      legend: { show: false },
      series: [
        {
          type: 'pie',
          radius: ['62%', '82%'],
          avoidLabelOverlap: false,
          itemStyle: { borderRadius: 6, borderColor: 'transparent', borderWidth: 2 },
          label: { show: false },
          labelLine: { show: false },
          emphasis: { scale: true, scaleSize: 4 },
          data: data.breakdown.map((entry) => ({
            name: t(`dashboard.states.${entry.state}`),
            value: entry.percent,
            itemStyle: {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: STATE_COLOR[entry.state] },
                  { offset: 1, color: `${STATE_COLOR[entry.state]}99` },
                ],
              },
            },
          })),
        },
      ],
      graphic: [
        {
          type: 'text',
          left: 'center',
          top: '42%',
          style: {
            text: `${data.utilization}%`,
            fontSize: 22,
            fontWeight: 700,
            fill: textColor,
            textAlign: 'center',
          },
        },
        {
          type: 'text',
          left: 'center',
          top: '58%',
          style: {
            text: t('dashboard.utilization.utilized'),
            fontSize: 10,
            fill: subColor,
            textAlign: 'center',
          },
        },
      ],
    } as EChartsOption;
  }, [data, t, textColor, subColor]);

  const barOption = useMemo(() => {
    if (!data) return null;
    const items = [...data.breakdown].sort((a, b) => b.percent - a.percent);
    return {
      grid: { left: 8, right: 28, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: Array<{ name: string; value: number }>) =>
          `${params[0]?.name ?? ''}: ${params[0]?.value ?? 0}%`,
      },
      xAxis: { type: 'value', max: 100, show: false },
      yAxis: {
        type: 'category',
        data: items.map((e) => t(`dashboard.states.${e.state}`)),
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: items.map((e) => ({
            value: e.percent,
            itemStyle: {
              borderRadius: 6,
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 1,
                y2: 0,
                colorStops: [
                  { offset: 0, color: `${STATE_COLOR[e.state]}CC` },
                  { offset: 1, color: STATE_COLOR[e.state] },
                ],
              },
            },
          })),
          barWidth: 12,
          label: {
            show: true,
            position: 'right',
            formatter: '{c}%',
            fontSize: 11,
            fontWeight: 600,
            color: subColor,
          },
        },
      ],
    } as EChartsOption;
  }, [data, t, subColor]);

  return (
    <WidgetCard titleKey="dashboard.widgets.utilization" icon={GaugeCircle} loading={isLoading}>
      {isLoading || !donutOption || !barOption ? (
        <div className="h-[220px] w-full animate-pulse rounded-lg bg-gray-100 dark:bg-white/5" />
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          {/* Donut with centered headline % */}
          <div className="size-[140px] shrink-0">
            <EChart option={donutOption} height={140} />
          </div>

          {/* Horizontal bars */}
          <div className="h-[140px] min-w-0 w-full flex-1">
            <EChart option={barOption} height={140} />
          </div>
        </div>
      )}
    </WidgetCard>
  );
}
