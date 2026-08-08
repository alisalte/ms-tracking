import { Box, Button, Chip, Skeleton, Stack, Typography } from '@mui/material';
import type { TFunction } from 'i18next';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useFleetStats } from '@/api/fleet.api';
import { status } from '@/theme/palette';
import type { FleetStats } from '@/types/fleet.types';

import { ActiveAlertsPanel } from './ActiveAlertsPanel';
import { FleetActivityChart } from './FleetActivityChart';
import { FleetMapPreview } from './FleetMapPreview';
import { FleetUtilizationPanel } from './FleetUtilizationPanel';
import { LiveBadge } from './LiveBadge';
import { StatCard } from './StatCard';
import { VehiclesAttentionList } from './VehiclesAttentionList';
import { WeatherWidget } from './WeatherWidget';

/** Stable keys for the 5 loading-state skeletons (static list, never reordered). */
const STAT_SKELETON_KEYS = [
  'sk-active',
  'sk-driving',
  'sk-idle',
  'sk-offline',
  'sk-alerts',
] as const;

/** Stat-card descriptors → accent color + drilldown status filter. */
function statCards(s: FleetStats | undefined, t: TFunction, navigate: (path: string) => void) {
  return [
    {
      titleKey: 'dashboard.stats.active',
      value: s?.totalActive ?? 0,
      accent: status.green,
      delta: s?.deltas?.totalActive,
      sparkline: s?.sparklines?.totalActive ?? [],
      onClick: () => navigate('/map'),
    },
    {
      titleKey: 'dashboard.stats.driving',
      value: s?.driving ?? 0,
      accent: status.green,
      delta: s?.deltas?.driving,
      sparkline: s?.sparklines?.driving ?? [],
      onClick: () => navigate('/map?status=driving'),
    },
    {
      titleKey: 'dashboard.stats.idle',
      value: s?.idle ?? 0,
      accent: status.amber,
      delta: s?.deltas?.idle,
      sparkline: s?.sparklines?.idle ?? [],
      onClick: () => navigate('/map?status=idle'),
    },
    {
      titleKey: 'dashboard.stats.offline',
      value: s?.offline ?? 0,
      accent: status.slate,
      delta: s?.deltas?.offline,
      sparkline: s?.sparklines?.offline ?? [],
      onClick: () => navigate('/map?status=offline'),
    },
    {
      titleKey: 'dashboard.stats.alerts',
      value: s?.alerts ?? 0,
      accent: s?.criticalAlerts ? status.red : status.slate,
      delta: s?.deltas?.alerts,
      sparkline: s?.sparklines?.alerts ?? [],
      meta:
        s && s.criticalAlerts > 0 ? (
          <Chip
            label={t('dashboard.stats.critical', { count: s.criticalAlerts })}
            size="small"
            color="error"
            variant="outlined"
            sx={{ height: 18, fontSize: '0.7rem' }}
          />
        ) : null,
      onClick: () => navigate('/map'),
    },
  ];
}

/**
 * DashboardGrid — the Fleet Dashboard's 12-column responsive layout.
 *
 * UI_UX_Design.md §1.3: a header (fleet name + live badge + export) over a
 * stat-card row, then a grid of widgets. The wireframe groups Fleet Activity,
 * Attention, and Map on the left/main column and Alerts, Utilization, and
 * Weather on the right. We use a responsive 12-col grid that collapses to one
 * column on small screens.
 */
export function DashboardGrid() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: stats, isLoading } = useFleetStats();

  const cards = statCards(stats, t, navigate);

  return (
    <Box>
      {/* ── Header (§1.3): fleet name · live overview · live badge · export ── */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ sm: 'center' }}
        justifyContent="space-between"
        gap={1}
        sx={{ mb: 3 }}
      >
        <Stack direction="row" alignItems="center" gap={1.5}>
          <Box>
            <Typography variant="h4" fontWeight={700}>
              {t('dashboard.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('dashboard.subtitle')}
            </Typography>
          </Box>
          <LiveBadge />
        </Stack>

        <Button
          variant="outlined"
          size="small"
          startIcon={<Download size={16} />}
          onClick={() => {
            /* Export deferred (§1.5); placeholder action. */
          }}
        >
          {t('dashboard.export')}
        </Button>
      </Stack>

      {/* ── Stat-card row (5 cards) ── */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(2, 1fr)',
            md: 'repeat(5, 1fr)',
          },
          gap: 2,
          mb: 2,
        }}
      >
        {isLoading
          ? STAT_SKELETON_KEYS.map((k) => (
              <Skeleton key={k} variant="rounded" sx={{ height: 132 }} />
            ))
          : cards.map((card) => <StatCard key={card.titleKey} {...card} />)}
      </Box>

      {/* ── Widget grid (12-col) ── */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'repeat(12, 1fr)' },
          gap: 2,
        }}
      >
        {/* Left/main column: Activity (8) + Attention (8) + Map (8) */}
        <Box sx={{ gridColumn: { xs: '1', lg: 'span 8' } }}>
          <FleetActivityChart />
        </Box>
        <Box sx={{ gridColumn: { xs: '1', lg: 'span 4' } }}>
          <ActiveAlertsPanel />
        </Box>

        <Box sx={{ gridColumn: { xs: '1', lg: 'span 5' } }}>
          <VehiclesAttentionList />
        </Box>
        <Box sx={{ gridColumn: { xs: '1', lg: 'span 4' } }}>
          <FleetUtilizationPanel />
        </Box>
        <Box sx={{ gridColumn: { xs: '1', lg: 'span 3' } }}>
          <WeatherWidget />
        </Box>

        <Box sx={{ gridColumn: { xs: '1', lg: 'span 12' } }}>
          <FleetMapPreview />
        </Box>
      </Box>
    </Box>
  );
}
