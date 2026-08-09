import { Box, Button, Chip, Stack } from '@mui/material';
import type { TFunction } from 'i18next';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useFleetStats } from '@/api/fleet.api';
import { status } from '@/theme/palette';

import { ActiveAlertsPanel } from './ActiveAlertsPanel';
import { AlertTypeBreakdownChart } from './AlertTypeBreakdownChart';
import { FleetActivityChart } from './FleetActivityChart';
import { FleetMapPreview } from './FleetMapPreview';
import { FleetPerformanceChart } from './FleetPerformanceChart';
import { FleetUtilizationPanel } from './FleetUtilizationPanel';
import { KpiCard } from './KpiCard';
import { LiveBadge } from './LiveBadge';
import { VehiclesAttentionList } from './VehiclesAttentionList';
import { WeatherWidget } from './WeatherWidget';

/**
 * DashboardGrid — the Fleet Dashboard, rebuilt as a Limitless-style dashboard.
 *
 * Layout (Limitless Layout 1 default dashboard pattern):
 * 1. Page header: fleet name + live badge + export
 * 2. KPI card row — Limitless stat cards: circular icon badge + big value +
 *    label + trend %. Four headline metrics.
 * 3. Two-column grid: Fleet Activity chart (wide) + Active Alerts (narrow)
 * 4. Three-column grid: Vehicles Attention + Fleet Utilization + Weather
 * 5. Full-width Fleet Map Preview
 *
 * All data is mock-backed (useFleetStats) so the dashboard is fully demoable.
 */
export function DashboardGrid() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: stats } = useFleetStats();

  return (
    <Box>
      {/* ── Header ── */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ sm: 'center' }}
        justifyContent="space-between"
        gap={1}
        sx={{ mb: 2 }}
      >
        <Stack direction="row" alignItems="center" gap={1.5}>
          <Box>
            <Box sx={{ fontSize: '1.3125rem', fontWeight: 500, lineHeight: 1.35 }}>
              {t('dashboard.title')}
            </Box>
            <Box sx={{ fontSize: '0.8125rem', color: 'text.secondary' }}>
              {t('dashboard.subtitle')}
            </Box>
          </Box>
          <LiveBadge />
        </Stack>
        <Button
          variant="outlined"
          size="small"
          startIcon={<Download size={16} />}
          onClick={() => {
            /* Export deferred */
          }}
        >
          {t('dashboard.export')}
        </Button>
      </Stack>

      {/* ── KPI card row (Limitless stat cards) ── */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(5, 1fr)' },
          gap: 2,
          mb: 2,
        }}
      >
        {kpiCards(stats, t, navigate).map((card) => (
          <KpiCard key={card.titleKey} {...card} />
        ))}
      </Box>

      {/* ── Activity (8) + Alerts (4) ── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(12, 1fr)' }, gap: 2, mb: 2 }}>
        <Box sx={{ gridColumn: { xs: '1', lg: 'span 8' } }}>
          <FleetActivityChart />
        </Box>
        <Box sx={{ gridColumn: { xs: '1', lg: 'span 4' } }}>
          <ActiveAlertsPanel />
        </Box>
      </Box>

      {/* ── Alert types (4) + Utilization (4) + Performance (4) ── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(12, 1fr)' }, gap: 2, mb: 2 }}>
        <Box sx={{ gridColumn: { xs: '1', lg: 'span 4' } }}>
          <AlertTypeBreakdownChart />
        </Box>
        <Box sx={{ gridColumn: { xs: '1', lg: 'span 4' } }}>
          <FleetUtilizationPanel />
        </Box>
        <Box sx={{ gridColumn: { xs: '1', lg: 'span 4' } }}>
          <FleetPerformanceChart />
        </Box>
      </Box>

      {/* ── Attention (8) + Weather (4) ── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(12, 1fr)' }, gap: 2, mb: 2 }}>
        <Box sx={{ gridColumn: { xs: '1', lg: 'span 8' } }}>
          <VehiclesAttentionList />
        </Box>
        <Box sx={{ gridColumn: { xs: '1', lg: 'span 4' } }}>
          <WeatherWidget />
        </Box>
      </Box>

      {/* ── Map preview (full width) ── */}
      <Box>
        <FleetMapPreview />
      </Box>
    </Box>
  );
}

/** KPI card descriptors — circular icon + value + label + trend + sparkline. */
function kpiCards(s: ReturnType<typeof useFleetStats>['data'] | undefined, _t: TFunction, _navigate: (p: string) => void) {
  return [
    {
      titleKey: 'dashboard.stats.active',
      value: s?.totalActive ?? 0,
      icon: '🚛' as const,
      iconColor: status.success,
      delta: s?.deltas?.totalActive,
      deltaLabel: 'vs yesterday',
      sparkline: s?.sparklines?.totalActive,
    },
    {
      titleKey: 'dashboard.stats.driving',
      value: s?.driving ?? 0,
      icon: '🛣️' as const,
      iconColor: status.blue,
      delta: s?.deltas?.driving,
      deltaLabel: 'vs yesterday',
      sparkline: s?.sparklines?.driving,
    },
    {
      titleKey: 'dashboard.stats.idle',
      value: s?.idle ?? 0,
      icon: '🅿️' as const,
      iconColor: status.warning,
      delta: s?.deltas?.idle,
      deltaLabel: 'vs yesterday',
      sparkline: s?.sparklines?.idle,
    },
    {
      titleKey: 'dashboard.stats.alerts',
      value: s?.alerts ?? 0,
      icon: '🔔' as const,
      iconColor: status.danger,
      delta: s?.deltas?.alerts,
      deltaLabel: 'vs yesterday',
      sparkline: s?.sparklines?.alerts,
      meta: s && s.criticalAlerts > 0 ? (
        <Chip
          label={`${s.criticalAlerts} CRIT`}
          size="small"
          color="error"
          variant="outlined"
          sx={{ height: 16, fontSize: '0.6rem' }}
        />
      ) : undefined,
    },
    {
      titleKey: 'dashboard.stats.offline',
      value: s?.offline ?? 0,
      icon: '📡' as const,
      iconColor: status.slate,
      delta: s?.deltas?.offline,
      deltaLabel: 'vs yesterday',
      sparkline: s?.sparklines?.offline,
    },
  ];
}
