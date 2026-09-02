import type { ApexOptions } from 'apexcharts';

import { chart } from '@/theme/palette';

/**
 * Mixed column + line chart — ApexCharts "Line & Column" demo layout
 * (https://apexcharts.com/javascript-chart-demos/mixed-charts/line-column/).
 * Distance as rounded gradient columns, trips as a smooth line on a second axis.
 */
export function mixedDistanceTrips(
  points: Array<{ day: string; distanceKm: number; trips: number }>,
  labels: { distance: string; trips: string },
  locale: string,
): { series: NonNullable<ApexOptions['series']>; options: ApexOptions } {
  const dense = points.length > 10;
  const categories = points.map((p) => formatUtcDay(p.day, locale));

  return {
    series: [
      {
        name: labels.distance,
        type: 'column',
        data: points.map((p) => Number(p.distanceKm.toFixed(1))),
      },
      {
        name: labels.trips,
        type: 'line',
        data: points.map((p) => p.trips),
      },
    ],
    options: {
      chart: {
        stacked: false,
        dropShadow: {
          enabled: true,
          enabledOnSeries: [1],
          top: 4,
          left: 0,
          blur: 8,
          color: chart.trips,
          opacity: 0.28,
        },
      },
      colors: [chart.distance, chart.trips],
      stroke: { width: [0, 3], curve: 'smooth', lineCap: 'round' },
      fill: {
        type: ['gradient', 'solid'],
        opacity: [1, 1],
        gradient: {
          shade: 'light',
          type: 'vertical',
          shadeIntensity: 0.35,
          opacityFrom: 0.95,
          opacityTo: 0.55,
          stops: [0, 100],
        },
      },
      markers: { size: [0, 5], strokeWidth: 0, hover: { size: 7 } },
      plotOptions: {
        bar: {
          columnWidth: dense ? '46%' : '40%',
          borderRadius: dense ? 4 : 6,
          borderRadiusApplication: 'end',
        },
      },
      dataLabels: { enabled: false },
      legend: {
        position: 'top',
        horizontalAlign: 'right',
        offsetY: 0,
        itemMargin: { horizontal: 14, vertical: 0 },
      },
      grid: { padding: { top: 4, bottom: 0, left: 6, right: 10 } },
      xaxis: {
        categories,
        labels: {
          rotate: dense ? -40 : 0,
          hideOverlappingLabels: true,
          trim: true,
        },
      },
      yaxis: [
        {
          seriesName: labels.distance,
          min: 0,
          forceNiceScale: true,
          decimalsInFloat: 0,
          labels: { formatter: formatKmTick },
        },
        {
          seriesName: labels.trips,
          opposite: true,
          min: 0,
          forceNiceScale: true,
          decimalsInFloat: 0,
          labels: { formatter: (v: number) => String(Math.round(v)) },
        },
      ],
      tooltip: {
        shared: true,
        intersect: false,
        y: {
          formatter: (val: number, opts?: { seriesIndex?: number }) => {
            if (opts?.seriesIndex === 0) {
              return `${Number(val).toLocaleString(locale, { maximumFractionDigits: 1 })} km`;
            }
            return String(Math.round(val));
          },
        },
      },
    },
  };
}

function formatUtcDay(day: string, locale: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return day.slice(5);
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatKmTick(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(v));
}
