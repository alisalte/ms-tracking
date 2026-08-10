import { Box, Card, CardContent, Stack, Typography } from '@mui/material';
import type { EChartsOption } from 'echarts';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useThemeContext } from '@/theme/ThemeRegistry';
import { glass } from '@/theme/palette';
import { EChart } from './EChart';

interface KpiCardProps {
  /** i18n key for the card label. */
  titleKey: string;
  /** Headline value. */
  value: number;
  /** Lucide icon rendered inside the gradient badge (preferred over emoji). */
  icon?: LucideIcon;
  /** Emoji fallback (legacy) — ignored when `icon` is set. */
  emoji?: string;
  /** Badge gradient end color (semantic). A matching lighter top stop is derived. */
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
 * KpiCard — a glassmorphism stat card with a gradient icon badge.
 *
 * v5: replaces the old emoji-in-a-circle with a Lucide icon inside a soft
 * gradient glass badge, a larger tabular headline value, a modern tinted trend
 * chip, and a gradient sparkline. The card itself is a frosted glass surface
 * with a colored glow that tracks the metric's semantic color.
 */
export function KpiCard({
  titleKey,
  value,
  icon: Icon,
  emoji,
  iconColor = '#2196F3',
  delta,
  deltaLabel,
  meta,
  sparkline,
  onClick,
}: KpiCardProps) {
  const { t } = useTranslation();
  const { mode } = useThemeContext();
  const g = mode === 'dark' ? glass.dark : glass.light;

  const isUp = (delta ?? 0) > 0;
  const isDown = (delta ?? 0) < 0;
  const trendColor = isUp ? '#16A34A' : isDown ? '#DC2626' : '#64748B';
  const trendBg = isUp
    ? 'rgba(22,163,74,0.12)'
    : isDown
      ? 'rgba(220,38,38,0.12)'
      : 'rgba(100,116,139,0.12)';

  const sparkOption = useSparkline(sparkline, iconColor);

  return (
    <Card
      className="fv-glass fv-glass-edge fv-glass-sheen"
      onClick={onClick}
      sx={{
        height: '100%',
        cursor: onClick ? 'pointer' : 'default',
        borderRadius: glass.radius,
        backgroundColor: g.bg,
        border: `1px solid ${g.border}`,
        boxShadow: g.shadow,
        position: 'relative',
        overflow: 'hidden',
        transition: 'box-shadow 0.25s ease, transform 0.25s ease, background-color 0.25s ease',
        '&:hover': {
          boxShadow: g.shadowHover,
          backgroundColor: g.hover,
          transform: 'translateY(-2px)',
        },
        // Colored radial glow behind the icon that tracks the semantic color.
        '&::before': {
          content: '""',
          position: 'absolute',
          insetInlineStart: -30,
          top: -30,
          width: 130,
          height: 130,
          background: `radial-gradient(circle, ${iconColor}26 0%, transparent 65%)`,
          pointerEvents: 'none',
          zIndex: 0,
        },
        '&::after': { pointerEvents: 'none' },
      }}
    >
      <CardContent sx={{ p: 2, position: 'relative', zIndex: 3, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" alignItems="flex-start" gap={1.5}>
          {/* Gradient glass icon badge */}
          {(Icon || emoji) && (
            <Stack
              alignItems="center"
              justifyContent="center"
              sx={{
                width: 46,
                height: 46,
                borderRadius: glass.radiusSm,
                background: `linear-gradient(135deg, ${iconColor}33 0%, ${iconColor}14 100%)`,
                border: `1px solid ${iconColor}40`,
                color: iconColor,
                flexShrink: 0,
                boxShadow: `inset 0 1px 0 ${iconColor}30`,
              }}
            >
              {Icon ? (
                <Icon size={20} />
              ) : (
                <Box component="span" sx={{ fontSize: '1.3rem', lineHeight: 1 }}>
                  {emoji}
                </Box>
              )}
            </Stack>
          )}
          <Stack sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="overline" sx={{ lineHeight: 1.5, color: 'text.secondary' }}>
              {t(titleKey)}
            </Typography>
            <Typography
              sx={{
                fontSize: '1.85rem',
                fontWeight: 700,
                lineHeight: 1.1,
                fontVariantNumeric: 'tabular-nums',
                color: 'text.primary',
                letterSpacing: '-0.02em',
              }}
            >
              {value.toLocaleString()}
            </Typography>
            {/* Trend chip */}
            {delta !== undefined && (
              <Stack
                direction="row"
                alignItems="center"
                gap={0.75}
                sx={{ mt: 0.5, flexWrap: 'wrap' }}
              >
                <Stack
                  direction="row"
                  alignItems="center"
                  gap={0.25}
                  sx={{
                    px: 0.75,
                    py: 0.125,
                    borderRadius: 99,
                    backgroundColor: trendBg,
                  }}
                >
                  {isUp && <ArrowUp size={12} color={trendColor} strokeWidth={3} />}
                  {isDown && <ArrowDown size={12} color={trendColor} strokeWidth={3} />}
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 700,
                      color: trendColor,
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: '0.7rem',
                    }}
                  >
                    {isUp ? '+' : ''}
                    {delta}
                  </Typography>
                </Stack>
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
          <Box sx={{ mt: 0.5, height: 42, mx: -0.5 }}>
            <EChart option={sparkOption} height={42} />
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
          lineStyle: { width: 2.5, color },
          areaStyle: {
            opacity: 1,
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${color}59` },
                { offset: 1, color: `${color}00` },
              ],
            },
          },
          markPoint: {
            symbol: 'circle',
            symbolSize: 6,
            data: [{ type: 'max' }],
            itemStyle: { color, borderColor: '#fff', borderWidth: 1.5 },
            label: { show: false },
          },
        },
      ],
    } as EChartsOption;
  }, [series, color]);
}
