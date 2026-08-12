import type { EChartsOption } from 'echarts';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { EChart } from './EChart';

interface KpiCardProps {
  /** i18n key for the card label. */
  titleKey: string;
  /** Headline value. */
  value: number;
  /** Emoji or text icon shown inside the circular badge. */
  icon?: string;
  /** Circular badge background color (semantic). */
  iconColor?: string;
  /** Signed delta vs previous period. */
  delta?: number;
  /** Already-translated delta caption (e.g. "vs yesterday"). */
  deltaLabel?: string;
  /** Optional secondary line node (e.g. "2 CRIT" chip). */
  meta?: React.ReactNode;
  /**
   * 7-point sparkline series (oldest → newest). When provided, a gradient
   * sparkline is rendered along the foot of the card for trend context.
   */
  sparkline?: number[];
  /** Drilldown handler. */
  onClick?: () => void;
}

/**
 * KpiCard — the TailAdmin stat card with an ECharts sparkline.
 *
 * Layout: circular icon badge (start) + a large headline value, small uppercase
 * label, and a trend indicator (▲ green / ▼ red) with a percentage, followed
 * by a gradient sparkline along the bottom edge when `sparkline` data is
 * supplied. The sparkline color tracks the card's semantic `iconColor` so each
 * metric reads consistently with the rest of the dashboard.
 *
 * Tailwind surface; chart engine unchanged.
 */
export function KpiCard({
  titleKey,
  value,
  icon,
  iconColor = '#465FFB',
  delta,
  deltaLabel,
  meta,
  sparkline,
  onClick,
}: KpiCardProps) {
  const { t } = useTranslation();
  const isUp = (delta ?? 0) > 0;
  const isDown = (delta ?? 0) < 0;
  const trendColor = isUp ? '#12B76A' : isDown ? '#F04438' : '#667085';

  const sparkOption = useSparkline(sparkline, iconColor);

  // When the card is interactive, render a <button> (keyboard-accessible by
  // default); otherwise a plain <div>. Both share the same classes + content.
  const Tag = onClick ? 'button' : 'div';
  const interactiveProps = onClick
    ? { type: 'button' as const, onClick, 'aria-label': t(titleKey) }
    : {};

  return (
    <Tag
      {...interactiveProps}
      className={[
        'block h-full w-full rounded-xl border border-gray-200 bg-white p-4 text-start shadow-sm',
        'dark:border-white/5 dark:bg-graydark-200',
        onClick
          ? 'cursor-pointer transition-shadow duration-150 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:border-white/10'
          : '',
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        {/* Circular icon badge — TailAdmin signature */}
        {icon && (
          <div
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-[1.35rem] leading-none"
            style={{ backgroundColor: `${iconColor}1A` }}
          >
            <span>{icon}</span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <span className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-graydark-600">
            {t(titleKey)}
          </span>
          <span className="block text-[1.6rem] font-bold leading-tight tabular-nums text-gray-900 dark:text-white">
            {value.toLocaleString()}
          </span>
          {/* Trend indicator */}
          {delta !== undefined && (
            <div className="mt-0.5 flex items-center gap-1">
              {isUp && <ArrowUp size={14} style={{ color: trendColor }} />}
              {isDown && <ArrowDown size={14} style={{ color: trendColor }} />}
              <span className="text-xs font-semibold tabular-nums" style={{ color: trendColor }}>
                {isUp ? '+' : ''}
                {delta}
              </span>
              {deltaLabel && (
                <span className="text-xs text-gray-500 dark:text-graydark-600">{deltaLabel}</span>
              )}
              {meta}
            </div>
          )}
        </div>
      </div>

      {/* Gradient sparkline — 7-point trend along the foot of the card */}
      {sparkOption && (
        <div className="-mx-1 mt-1 h-10">
          <EChart option={sparkOption} height={40} />
        </div>
      )}
    </Tag>
  );
}

/**
 * Build a sparkline ECharts option from a numeric series.
 *
 * Axis-less, gradient-filled, colored by the card's semantic color. Uses a
 * unique gradient id per color so multiple cards on the same page don't clash.
 */
function useSparkline(series: number[] | undefined, color: string): EChartsOption | null {
  return useMemo(() => {
    if (!series || series.length < 2) return null;
    const data = series.map((v, i) => [i, v]);
    return {
      grid: { left: 0, right: 0, top: 4, bottom: 0, containLabel: false },
      xAxis: { type: 'category', show: false, boundaryGap: false },
      yAxis: { type: 'value', show: false, scale: true },
      tooltip: { show: false },
      series: [
        {
          type: 'line',
          data,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color },
          areaStyle: {
            opacity: 1,
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${color}66` },
                { offset: 1, color: `${color}00` },
              ],
            },
          },
          markPoint: {
            symbol: 'circle',
            symbolSize: 5,
            data: [{ type: 'max' }],
            itemStyle: { color },
            label: { show: false },
          },
        },
      ],
    } as EChartsOption;
  }, [series, color]);
}
