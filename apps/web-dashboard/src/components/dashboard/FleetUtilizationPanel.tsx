import { Box, Skeleton, Stack } from '@mui/material';
import type { EChartsOption } from 'echarts';
import { GaugeCircle } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFleetUtilization } from '@/api/fleet.api';
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
 * / offline). Rebuilt on ECharts for richer gradients and theme-aware styling.
 */
export function FleetUtilizationPanel() {
  const { t } = useTranslation();
  const { data, isLoading } = useFleetUtilization();

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
            fill: 'var(--mui-palette-text-primary)',
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
            fill: 'var(--mui-palette-text-secondary)',
            textAlign: 'center',
          },
        },
      ],
    } as EChartsOption;
  }, [data, t]);

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
            color: 'var(--mui-palette-text-secondary)',
          },
        },
      ],
    } as EChartsOption;
  }, [data, t]);

  return (
    <WidgetCard titleKey="dashboard.widgets.utilization" icon={GaugeCircle} loading={isLoading}>
      {isLoading || !donutOption || !barOption ? (
        <Skeleton variant="rounded" sx={{ width: '100%', height: 220 }} />
      ) : (
        <Stack direction={{ xs: 'column', sm: 'row' }} gap={2} alignItems="center">
          {/* Donut with centered headline % */}
          <Box sx={{ width: 140, height: 140, flexShrink: 0 }}>
            <EChart option={donutOption} height={140} />
          </Box>

          {/* Horizontal bars */}
          <Box sx={{ flex: 1, width: '100%', minWidth: 0, height: 140 }}>
            <EChart option={barOption} height={140} />
          </Box>
        </Stack>
      )}
    </WidgetCard>
  );
}
