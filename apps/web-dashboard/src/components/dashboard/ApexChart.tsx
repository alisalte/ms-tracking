import type { ApexOptions } from 'apexcharts';
import { useMemo } from 'react';
import Chart from 'react-apexcharts';

import { useThemeContext } from '@/theme/ThemeRegistry';

/** Chart types accepted by react-apexcharts Props. */
export type ApexChartType = NonNullable<React.ComponentProps<typeof Chart>['type']>;

export interface ApexChartProps {
  /** ApexCharts series type (donut, bar, line, area, …). */
  type: ApexChartType;
  /** Chart series — shape depends on `type` (see ApexCharts docs). */
  series: ApexOptions['series'];
  /** Caller options merged over theme-aware defaults. */
  options?: ApexOptions;
  /** Chart height in px (default 260). */
  height?: number | string;
  /** Extra class on the outer wrapper. */
  className?: string;
}

/**
 * ApexChart — theme-aware ApexCharts wrapper for the dashboard.
 *
 * Mirrors the former EChart contract: dark/light axis/tooltip/grid tokens from
 * `useThemeContext`, series colors supplied by callers via `@/theme/palette`.
 * Charts stay LTR under RTL (numeric axes / time series convention).
 */
export function ApexChart({
  type,
  series,
  options,
  height = 260,
  className = '',
}: ApexChartProps) {
  const { mode } = useThemeContext();
  const isDark = mode === 'dark';

  const merged = useMemo<ApexOptions>(() => {
    const axisColor = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(15,23,42,0.55)';
    const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.06)';

    const base: ApexOptions = {
      chart: {
        type,
        fontFamily: 'inherit',
        background: 'transparent',
        toolbar: { show: false },
        zoom: { enabled: false },
        animations: { enabled: true, speed: 450 },
        foreColor: axisColor,
      },
      theme: { mode: isDark ? 'dark' : 'light' },
      grid: {
        borderColor: gridColor,
        strokeDashArray: 4,
        padding: { left: 4, right: 8, top: 0, bottom: 0 },
      },
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 2 },
      legend: {
        fontSize: '11px',
        fontWeight: 600,
        labels: { colors: axisColor },
        markers: { size: 6, strokeWidth: 0 },
      },
      tooltip: {
        theme: isDark ? 'dark' : 'light',
        style: { fontSize: '12px' },
        cssClass: 'fv-apex-tooltip',
      },
      xaxis: {
        labels: { style: { colors: axisColor, fontSize: '11px' } },
        axisBorder: { color: gridColor },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: { style: { colors: axisColor, fontSize: '11px' } },
      },
      plotOptions: {
        bar: { borderRadius: 3, columnWidth: '55%' },
        pie: {
          donut: {
            labels: {
              show: true,
              name: { color: axisColor },
              value: {
                color: isDark ? '#fff' : '#101828',
                fontWeight: 700,
                fontSize: '22px',
              },
              total: {
                show: true,
                label: '',
                color: axisColor,
                fontSize: '11px',
              },
            },
          },
        },
      },
    };

    return deepMergeOptions(base, options ?? {});
  }, [type, options, isDark]);

  return (
    <div className={`w-full dir-ltr ${className}`} data-testid="apex-chart">
      <Chart type={type} series={series} options={merged} height={height} width="100%" />
      <style>{`
        .fv-apex-tooltip {
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border-radius: 12px !important;
          box-shadow: 0 8px 28px rgba(0,0,0,0.16) !important;
        }
      `}</style>
    </div>
  );
}

/** Shallow-deep merge for Apex option trees (arrays replaced, objects merged). */
function deepMergeOptions(base: ApexOptions, override: ApexOptions): ApexOptions {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    if (value === undefined) continue;
    const prev = out[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      prev &&
      typeof prev === 'object' &&
      !Array.isArray(prev)
    ) {
      out[key] = deepMergeOptions(prev as ApexOptions, value as ApexOptions);
    } else {
      out[key] = value;
    }
  }
  return out as ApexOptions;
}
