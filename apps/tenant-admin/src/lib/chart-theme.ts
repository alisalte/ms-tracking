import type { ApexOptions } from 'apexcharts';

export const CHART_COLORS = ['#0f766e', '#0f1c2e', '#0369a1', '#c2410c', '#7c3aed', '#ca8a04'];

export const LICENSE_STATUS_COLORS = {
  ACTIVE: '#0f766e',
  GRACE: '#ca8a04',
  EXPIRED: '#be123c',
  NONE: '#94a3b8',
} as const;

export const INVOICE_STATUS_COLORS = {
  PAID: '#0f766e',
  ISSUED: '#0369a1',
  OVERDUE: '#c2410c',
  VOID: '#94a3b8',
} as const;

export function chartBase(overrides: ApexOptions = {}): ApexOptions {
  const { chart, colors, dataLabels, grid, legend, stroke, tooltip, ...rest } = overrides;
  return {
    chart: {
      fontFamily: 'inherit',
      toolbar: { show: false },
      zoom: { enabled: false },
      parentHeightOffset: 0,
      animations: { enabled: true, speed: 400 },
      ...chart,
    },
    colors: colors ?? CHART_COLORS,
    dataLabels: { enabled: false, ...dataLabels },
    grid: {
      borderColor: '#e7e5e4',
      strokeDashArray: 3,
      padding: { top: 4, right: 8, bottom: 0, left: 4 },
      ...grid,
    },
    legend: {
      fontSize: '12px',
      fontFamily: 'inherit',
      labels: { colors: '#64748b' },
      ...legend,
    },
    stroke: { width: 2, ...stroke },
    tooltip: { theme: 'light', ...tooltip },
    ...rest,
  };
}
