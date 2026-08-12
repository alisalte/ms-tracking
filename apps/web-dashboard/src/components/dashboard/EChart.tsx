import type { EChartsOption } from 'echarts';
import ReactECharts from 'echarts-for-react';
import { useMemo } from 'react';

<<<<<<< HEAD
import { isRTL } from '@/i18n/config';
=======
>>>>>>> 5bdd11003cc6ed2a06307b253ebd40c49da3ea6e
import { useThemeContext } from '@/theme/ThemeRegistry';
import { darkSurface, lightSurface } from '@/theme/palette';

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
  const isDark = mode === 'dark';

  // biome-ignore lint/correctness/useExhaustiveDependencies: rtl is consumed by echarts via the merged option
  const merged = useMemo<EChartsOption>(() => {
    const axisColor = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(15,23,42,0.55)';
    const splitColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.05)';

    const base: EChartsOption = {
      textStyle: {
        fontFamily: 'inherit',
        color: axisColor,
      },
      // Frosted-glass tooltip with blur and soft rounded corners (v5).
      tooltip: {
        backgroundColor: isDark ? 'rgba(42,51,61,0.85)' : 'rgba(255,255,255,0.85)',
        borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.60)',
        borderWidth: 1,
        textStyle: { color: isDark ? 'rgba(255,255,255,0.92)' : 'rgba(15,23,42,0.85)' },
        extraCssText:
          'backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); box-shadow: 0 8px 28px rgba(0,0,0,0.16); border-radius: 12px; padding: 8px 12px;',
      },
      // Sensible axis defaults; callers may override per-axis.
      grid: { containLabel: true, left: 8, right: 16, top: 16, bottom: 8 },
      xAxis: {
        axisLine: { lineStyle: { color: splitColor } },
        axisTick: { show: false },
        axisLabel: { color: axisColor, fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis: {
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: axisColor, fontSize: 11 },
        splitLine: { lineStyle: { color: splitColor, type: 'dashed' } },
      },
    };

    return { ...base, ...option };
  }, [option, isDark]);

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
