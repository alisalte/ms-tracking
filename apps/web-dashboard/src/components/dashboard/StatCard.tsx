import { Box, Card, CardActionArea, Skeleton, Stack, Typography } from '@mui/material';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

interface StatCardProps {
  /** i18n key for the card label (e.g. "dashboard.stats.active"). */
  titleKey: string;
  /** Headline value. */
  value: number;
  /** 7-point sparkline series (oldest → newest). */
  sparkline: number[];
  /** Accent color token for the value + sparkline gradient (theme path or hex). */
  accent?: string;
  /** Signed delta vs the previous period — rendered as an arrow + colored chip. */
  delta?: number;
  /** Optional secondary line under the value (e.g. "2 CRIT" or "59%"). */
  meta?: ReactNode;
  /** Drilldown handler — clicking the card navigates (UI_UX_Design.md §1.5). */
  onClick?: () => void;
  /** While the underlying data is loading, render a skeleton. */
  loading?: boolean;
}

/**
 * StatCard — reusable KPI tile (UI_UX_Design.md §0.5, §1.4).
 *
 * Top row of the Fleet Dashboard: an uppercase Limitless label, a big value, a
 * delta-vs-yesterday chip, a 7-point sparkline, and an optional secondary line.
 * The whole tile is clickable to drill into the Map filtered to that status.
 *
 * v3 (Limitless): uppercase tracked label, weight-700 tabular value, near-flat
 * 3px card, color reserved for meaning (§0.1) — the delta chip turns green/red
 * by direction, the accent tints the value + sparkline.
 */
export function StatCard({
  titleKey,
  value,
  sparkline,
  accent = 'primary.main',
  delta,
  meta,
  onClick,
  loading = false,
}: StatCardProps) {
  const { t } = useTranslation();
  const data = sparkline.map((v, i) => ({ i, v }));
  // A stable id so each card gets its own gradient stop.
  const gradId = `statcard-grad-${titleKey.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <Card
      sx={{
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        ...(onClick && { cursor: 'pointer' }),
      }}
    >
      <CardActionArea
        onClick={onClick}
        disabled={!onClick}
        sx={{ height: '100%', p: 2, alignItems: 'stretch', '&:hover': {} }}
      >
        <Stack direction="column" gap={0.75} sx={{ height: '100%' }}>
          <Typography
            variant="overline"
            sx={{ lineHeight: 1.6667, color: 'text.secondary' }}
          >
            {t(titleKey)}
          </Typography>

          {loading ? (
            <Skeleton variant="text" width="60%" height={36} />
          ) : (
            <Typography
              variant="h4"
              component="div"
              fontWeight={700}
              sx={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, color: accent }}
            >
              {value}
            </Typography>
          )}

          {/* Secondary line: delta chip and/or meta */}
          <Stack direction="row" alignItems="center" gap={1} sx={{ minHeight: 20 }}>
            {loading ? (
              <Skeleton variant="rounded" width={56} height={16} />
            ) : (
              <>
                {delta !== undefined && <DeltaChip delta={delta} />}
                {meta}
              </>
            )}
          </Stack>

          {/* Sparkline pinned to the bottom */}
          {!loading && (
            <Box sx={{ mt: 'auto', height: 30, width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={accent} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={accent} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke={accent}
                    strokeWidth={1.75}
                    fill={`url(#${gradId})`}
                    isAnimationActive={false}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          )}
        </Stack>
      </CardActionArea>
    </Card>
  );
}

/** Direction-aware delta chip: ▲ green for up, ▼ red for down, — neutral. */
function DeltaChip({ delta }: { delta: number }) {
  const { t } = useTranslation();
  if (delta === 0) {
    return (
      <Stack direction="row" alignItems="center" gap={0.25}>
        <Minus size={13} color="var(--mui-palette-text-secondary)" />
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {t('dashboard.noChange')}
        </Typography>
      </Stack>
    );
  }
  const up = delta > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  // For fleet metrics, "more active" is context-dependent; here we simply
  // encode direction (green up / red down) and let the label carry meaning.
  const color = up ? 'success.main' : 'error.main';
  return (
    <Stack direction="row" alignItems="center" gap={0.25}>
      <Icon size={13} color={`var(--mui-palette-${up ? 'success' : 'error'}-main)`} />
      <Typography
        variant="caption"
        fontWeight={700}
        sx={{ color, fontVariantNumeric: 'tabular-nums' }}
      >
        {up ? '+' : ''}
        {delta}
      </Typography>
    </Stack>
  );
}
