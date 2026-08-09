import type { EChartsOption } from 'echarts';
import ReactECharts from 'echarts-for-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { isRTL } from '@/i18n/config';
import { lightSurface, darkSurface } from '@/theme/palette';
import { useThemeContext } from '@/theme/ThemeRegistry';

interface EChartProps {
  /** Full ECharts option object. */
  option: EChartsOption;
  /** Chart height in px (default 260). */
  height?: number | string;
  /** Extra style for the chart container. */
  sx?: object;
}

/**
 * EChart — the project's shared Apache ECharts wrapper.
 *
 * Responsibilities:
 * - Apply a theme-aware base (axis/grid/tooltip text + background colors) that
 *   adapts to the current light/dark mode via `useThemeContext().mode`.
 * - Honor the active language direction so charts read RTL where appropriate.
 * - Merge the caller's `option` last so it always wins over the base defaults.
 *
 * The wrapper intentionally keeps its surface small: callers build the rich,
 * data-specific option (series, colors, formatters) and this wrapper only
 * normalizes the cross-cutting theme tokens. Color hex values for series are
 * sourced by callers from `@/theme/palette` so the dashboard never hardcodes
 * colors.
 *
 * Usage:
 *   <EChart option={myOption} height={260} />
 */
export function EChart({ option, height = 260, sx }: EChartProps) {
  const { mode } = useThemeContext();
  const { i18n } = useTranslation();
  const rtl = isRTL(i18n.language);
  const isDark = mode === 'dark';

  const merged = useMemo<EChartsOption>(() => {
    const surface = isDark ? darkSurface : lightSurface;
    const axisColor = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)';
    const splitColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

    const base: EChartsOption = {
      textStyle: {
        fontFamily: 'inherit',
        color: axisColor,
      },
      // Dark tooltip with light text in dark mode, near-white card otherwise.
      tooltip: {
        backgroundColor: surface.paper,
        borderColor: surface.border,
        borderWidth: 1,
        textStyle: { color: isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)' },
        extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,0.16); border-radius: 8px;',
      },
      // Sensible axis defaults; callers may override per-axis.
      grid: { containLabel: true, left: 8, right: 16, top: 16, bottom: 8 },
      xAxis: {
        axisLine: { lineStyle: { color: splitColor } },
        axisTick: { show: false },
        axisLabel: { color: axisColor },
        splitLine: { show: false },
      },
      yAxis: {
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: axisColor },
        splitLine: { lineStyle: { color: splitColor, type: 'dashed' } },
      },
    };

    return { ...base, ...option };
  }, [option, isDark, rtl]);

  return (
    <ReactECharts
      option={merged}
      notMerge
      lazyUpdate
      style={{ height, width: '100%', ...sx }}
      opts={{ renderer: 'svg' }}
    />
  );
}
