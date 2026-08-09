import { ArrowDown, ArrowUp } from 'lucide-react';
import { Box, Card, CardContent, Stack, Typography } from '@mui/material';
import type { EChartsOption } from 'echarts';
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
 * KpiCard — the Limitless stat card, upgraded with an ECharts sparkline.
 *
 * Layout: circular icon badge (left) + a large headline value, small uppercase
 * label, and a trend indicator (▲ green / ▼ red) with a percentage, followed
 * by a gradient sparkline along the bottom edge when `sparkline` data is
 * supplied. The sparkline color tracks the card's semantic `iconColor` so each
 * metric reads consistently with the rest of the dashboard.
 */
export function KpiCard({
  titleKey,
  value,
  icon,
  iconColor = '#2196F3',
  delta,
  deltaLabel,
  meta,
  sparkline,
  onClick,
}: KpiCardProps) {
  const { t } = useTranslation();
  const isUp = (delta ?? 0) > 0;
  const isDown = (delta ?? 0) < 0;
  const trendColor = isUp ? '#4CAF50' : isDown ? '#F44336' : '#777';

  const sparkOption = useSparkline(sparkline, iconColor);

  return (
    <Card
      onClick={onClick}
      sx={{
        height: '100%',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow 0.15s ease-in-out, transform 0.15s ease-in-out',
        '&:hover': onClick
          ? { boxShadow: '0 4px 16px rgba(0,0,0,0.10)', transform: 'translateY(-1px)' }
          : {},
      }}
    >
      <CardContent sx={{ p: 2, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" alignItems="flex-start" gap={1.5}>
          {/* Circular icon badge — Limitless signature */}
          {icon && (
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.35rem',
                flexShrink: 0,
                backgroundColor: `${iconColor}1A`,
              }}
            >
              <Typography component="span" sx={{ fontSize: '1.35rem', lineHeight: 1 }}>
                {icon}
              </Typography>
            </Box>
          )}
          <Stack sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="overline"
              sx={{ lineHeight: 1.5, color: 'text.secondary' }}
            >
              {t(titleKey)}
            </Typography>
            <Typography
              sx={{
                fontSize: '1.6rem',
                fontWeight: 700,
                lineHeight: 1.15,
                fontVariantNumeric: 'tabular-nums',
                color: 'text.primary',
              }}
            >
              {value.toLocaleString()}
            </Typography>
            {/* Trend indicator */}
            {delta !== undefined && (
              <Stack direction="row" alignItems="center" gap={0.5} sx={{ mt: 0.25 }}>
                {isUp && <ArrowUp size={14} color={trendColor} />}
                {isDown && <ArrowDown size={14} color={trendColor} />}
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 600, color: trendColor, fontVariantNumeric: 'tabular-nums' }}
                >
                  {isUp ? '+' : ''}
                  {delta}
                </Typography>
                {deltaLabel && (
                  <Typography variant="caption" color="text.secondary">
                    {deltaLabel}
                  </Typography>
                )}
                {meta}
              </Stack>
            )}
          </Stack>
        </Stack>

        {/* Gradient sparkline — 7-point trend along the foot of the card */}
        {sparkOption && (
          <Box sx={{ mt: 0.5, height: 40, mx: -0.5 }}>
            <EChart option={sparkOption} height={40} />
          </Box>
        )}
      </CardContent>
    </Card>
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
