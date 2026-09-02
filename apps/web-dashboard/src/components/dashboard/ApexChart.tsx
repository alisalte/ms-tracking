import type { ApexOptions } from 'apexcharts';
import { type ComponentProps, useMemo } from 'react';
import Chart from 'react-apexcharts';

import { apexPalette, chartSurface, neutral } from '@/theme/palette';
import { useThemeContext } from '@/theme/ThemeRegistry';

/** Chart types accepted by react-apexcharts Props. */
export type ApexChartType = NonNullable<ComponentProps<typeof Chart>['type']>;

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
 * ApexChart — theme-aware wrapper styled after the official ApexCharts
 * JavaScript demos (https://apexcharts.com/javascript-chart-demos/):
 * demo palette, smooth spline, gradient area fills, rounded columns,
 * drop-shadow lines, and donut separators on the page background.
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
    const axisColor = isDark ? 'rgba(255,255,255,0.62)' : 'rgba(55,65,81,0.78)';
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.07)';
    const sliceStroke = isDark ? chartSurface.dark : chartSurface.light;
    const isCartesian = type === 'line' || type === 'area' || type === 'bar';
    const isRadial = type === 'donut' || type === 'pie' || type === 'polarArea' || type === 'radialBar';

    const base: ApexOptions = {
      chart: {
        type,
        fontFamily: 'inherit',
        background: 'transparent',
        toolbar: { show: false },
        zoom: { enabled: false },
        parentHeightOffset: 0,
        animations: {
          enabled: true,
          speed: 700,
          easing: 'easeinout',
          animateGradually: { enabled: true, delay: 80 },
          dynamicAnimation: { enabled: true, speed: 350 },
        },
        dropShadow:
          type === 'line' || type === 'area'
            ? {
                enabled: true,
                enabledOnSeries: [0],
                top: 6,
                left: 0,
                blur: 8,
                color: apexPalette[0],
                opacity: 0.22,
              }
            : { enabled: false },
        foreColor: axisColor,
      },
      colors: [...apexPalette],
      theme: { mode: isDark ? 'dark' : 'light' },
      grid: {
        show: isCartesian,
        borderColor: gridColor,
        strokeDashArray: 4,
        xaxis: { lines: { show: false } },
        yaxis: { lines: { show: true } },
        padding: { left: 8, right: 12, top: 8, bottom: 0 },
      },
      dataLabels: { enabled: false },
      stroke: isRadial
        ? { show: true, width: 2, colors: [sliceStroke] }
        : {
            curve: 'smooth',
            width: type === 'bar' ? 0 : 3,
            lineCap: 'round',
          },
      fill:
        type === 'area'
          ? {
              type: 'gradient',
              gradient: {
                shade: isDark ? 'dark' : 'light',
                type: 'vertical',
                shadeIntensity: 0.55,
                opacityFrom: 0.52,
                opacityTo: 0.06,
                stops: [0, 90, 100],
              },
            }
          : type === 'bar'
            ? { type: 'solid', opacity: 1 }
            : { opacity: 0.92 },
      // ApexCharts 7 Globals.globalVars reads config.markers.size — never omit.
      markers:
        type === 'line' || type === 'area'
          ? { size: 0, strokeWidth: 0, hover: { size: 6, sizeOffset: 2 } }
          : { size: 0, strokeWidth: 0 },
      legend: {
        fontSize: '12px',
        fontWeight: 600,
        offsetY: 4,
        itemMargin: { horizontal: 10, vertical: 2 },
        labels: { colors: axisColor },
        markers: { size: 7, strokeWidth: 0, offsetX: -2 },
      },
      tooltip: {
        theme: isDark ? 'dark' : 'light',
        style: { fontSize: '12px' },
        cssClass: 'fv-apex-tooltip',
      },
      xaxis: {
        labels: { style: { colors: axisColor, fontSize: '11px', fontWeight: 500 } },
        axisBorder: { show: false },
        axisTicks: { show: false },
        tooltip: { enabled: false },
      },
      yaxis: {
        labels: { style: { colors: axisColor, fontSize: '11px', fontWeight: 500 } },
      },
      plotOptions: {
        line: { isSlopeChart: false },
        bar: {
          borderRadius: 6,
          borderRadiusApplication: 'end',
          columnWidth: '48%',
          barHeight: '62%',
        },
        pie: {
          expandOnClick: true,
          donut: {
            size: '72%',
            labels: {
              show: true,
              name: { color: axisColor, fontSize: '12px', fontWeight: 600, offsetY: 16 },
              value: {
                color: isDark ? chartSurface.light : neutral[900],
                fontWeight: 800,
                fontSize: '24px',
                offsetY: -10,
              },
              total: {
                show: true,
                label: '',
                color: axisColor,
                fontSize: '11px',
                fontWeight: 600,
              },
            },
          },
        },
        polarArea: {
          rings: { strokeWidth: 0 },
          spokes: { connectorColors: gridColor },
        },
      },
      states: {
        hover: { filter: { type: 'lighten', value: 0.08 } },
        active: { filter: { type: 'darken', value: 0.08 } },
      },
    };

    return deepMergeOptions(base, options ?? {});
  }, [type, options, isDark]);

  return (
    <div className={`w-full dir-ltr ${className}`} data-testid="apex-chart">
      <Chart type={type} series={series} options={merged} height={height} width="100%" />
      <style>{`
        .fv-apex-tooltip {
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-radius: 12px !important;
          box-shadow: 0 12px 32px ${chartSurface.tooltipGlow} !important;
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
