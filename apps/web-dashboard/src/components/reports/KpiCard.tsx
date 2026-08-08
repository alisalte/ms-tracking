/**
 * KpiCard — a KPI scorecard tile (Analytics-Reporting.md §3.3 KPIDefinition).
 *
 * Shows the value + unit, a target comparison, a threshold-derived color
 * (green/amber/red from warning/critical thresholds), and a trend arrow vs the
 * previous period. The trend color respects `higherIsBetter` (a cost KPI
 * trending down is good).
 */
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Kpi } from '@/types/report.types';
import { Box, Card, CardContent, LinearProgress, Stack, Typography } from '@mui/material';

interface KpiCardProps {
  kpi: Kpi;
}

/** Resolve the threshold-derived status color for a KPI. */
export function kpiStatusColor(kpi: Kpi): string {
  // For "higher is better" KPIs, falling below thresholds is bad; for cost-like
  // KPIs, exceeding them is bad.
  const bad = kpi.higherIsBetter
    ? kpi.value < (kpi.criticalThreshold ?? Number.NEGATIVE_INFINITY)
    : kpi.value > (kpi.criticalThreshold ?? Number.POSITIVE_INFINITY);
  const warn = kpi.higherIsBetter
    ? kpi.value < (kpi.warningThreshold ?? Number.NEGATIVE_INFINITY)
    : kpi.value > (kpi.warningThreshold ?? Number.POSITIVE_INFINITY);
  if (bad) return '#DC2626';
  if (warn) return '#F59E0B';
  return '#16A34A';
}

/** Resolve the trend color (respects higherIsBetter). */
function trendColor(kpi: Kpi): string {
  if (kpi.trendDirection === 'flat') return '#64748B';
  const up = kpi.trendDirection === 'up';
  const good = kpi.higherIsBetter ? up : !up;
  return good ? '#16A34A' : '#DC2626';
}

export function KpiCard({ kpi }: KpiCardProps) {
  const { t } = useTranslation();
  const color = kpiStatusColor(kpi);
  const tColor = trendColor(kpi);
  const TrendIcon =
    kpi.trendDirection === 'up' ? ArrowUp : kpi.trendDirection === 'down' ? ArrowDown : Minus;
  // Progress toward target (0–100%), clamped.
  const targetPct = kpi.target ? Math.min(100, Math.round((kpi.value / kpi.target) * 100)) : null;

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="caption" color="text.secondary" noWrap>
          {t(`reports.kpi.${kpi.id}`)}
        </Typography>
        <Stack direction="row" alignItems="baseline" gap={0.5} sx={{ mt: 0.5 }}>
          <Typography variant="h4" sx={{ fontWeight: 700, color }}>
            {kpi.value.toLocaleString(undefined, {
              maximumFractionDigits: kpi.unit === '$/km' ? 2 : 0,
            })}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {kpi.unit}
          </Typography>
        </Stack>
        <Stack direction="row" alignItems="center" gap={0.5} sx={{ mt: 0.5 }}>
          <TrendIcon size={14} color={tColor} />
          <Typography variant="caption" sx={{ color: tColor, fontWeight: 600 }}>
            {kpi.trend > 0 ? '+' : ''}
            {kpi.trend}
          </Typography>
          {kpi.target && (
            <Typography variant="caption" color="text.secondary">
              · {t('reports.target')}: {kpi.target}
            </Typography>
          )}
        </Stack>
        {targetPct !== null && (
          <Box sx={{ mt: 1 }}>
            <LinearProgress
              variant="determinate"
              value={targetPct}
              sx={{ height: 6, borderRadius: 3, '& .MuiLinearProgress-bar': { bgcolor: color } }}
            />
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
