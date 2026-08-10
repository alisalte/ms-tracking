import { Box, Button, Chip, Stack } from '@mui/material';
import type { TFunction } from 'i18next';
import {
  Bell,
  Download,
  type LucideIcon,
  ParkingSquare,
  Route,
  Truck,
  WifiOff,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useFleetStats } from '@/api/fleet.api';
import { useThemeContext } from '@/theme/ThemeRegistry';
import { glass, status } from '@/theme/palette';

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

/** Section gap between dashboard rows. */
const ROW_GAP = 2.25;

/**
 * DashboardGrid — the Fleet Dashboard, restyled with a glassmorphism + aurora
 * gradient look.
 *
 * Layout:
 * 1. Page header: title + subtitle + live badge + export, set against an aurora
 *    gradient banner with floating colored blobs.
 * 2. KPI row — five glass stat cards with Lucide icons, trend chips, sparklines.
 * 3. Two-column grid: Fleet Activity chart (wide) + Active Alerts (narrow)
 * 4. Three-column grid: Alert Types + Utilization + Performance
 * 5. Two-column grid: Vehicles Attention (wide) + Weather (narrow)
 * 6. Full-width Fleet Map Preview
 *
 * All data is mock-backed (useFleetStats) so the dashboard is fully demoable.
 */
export function DashboardGrid() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: stats } = useFleetStats();
  const { mode } = useThemeContext();

  const pageGradient = mode === 'dark' ? glass.pageGradientDark : glass.pageGradientLight;

  return (
    <Box
      sx={{
        // Soft tinted page background so the glass cards have depth.
        backgroundImage: pageGradient,
        backgroundAttachment: 'fixed',
        minHeight: '100%',
        borderRadius: { lg: 3 },
        p: { xs: 0.5, md: 1 },
      }}
    >
      {/* ── Header (aurora banner) ── */}
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: glass.radius,
          mb: ROW_GAP,
          p: { xs: 2, md: 2.5 },
          background:
            'linear-gradient(120deg, rgba(33,150,243,0.10), rgba(63,81,181,0.08), rgba(0,188,212,0.08))',
          border: '1px solid',
          borderColor: mode === 'dark' ? glass.dark.border : glass.light.border,
          boxShadow: mode === 'dark' ? glass.dark.shadow : glass.light.shadow,
        }}
      >
        {/* Floating aurora blobs */}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            insetInlineEnd: '-4%',
            top: '-60%',
            width: 320,
            height: 320,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${glass.aurora.blue} 0%, transparent 70%)`,
            filter: 'blur(20px)',
            animation: 'fv-float 9s ease-in-out infinite',
            pointerEvents: 'none',
          }}
        />
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            insetInlineEnd: '14%',
            top: '-40%',
            width: 240,
            height: 240,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${glass.aurora.indigo} 0%, transparent 70%)`,
            filter: 'blur(18px)',
            animation: 'fv-float 11s ease-in-out infinite reverse',
            pointerEvents: 'none',
          }}
        />
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            insetInlineEnd: '30%',
            top: '-50%',
            width: 200,
            height: 200,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${glass.aurora.cyan} 0%, transparent 70%)`,
            filter: 'blur(16px)',
            animation: 'fv-float 13s ease-in-out infinite',
            pointerEvents: 'none',
          }}
        />

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ sm: 'center' }}
          justifyContent="space-between"
          gap={1.5}
          sx={{ position: 'relative', zIndex: 2 }}
        >
          <Stack direction="row" alignItems="center" gap={1.5}>
            <Box>
              <Box
                sx={{
                  fontSize: { xs: '1.4rem', md: '1.625rem' },
                  fontWeight: 700,
                  lineHeight: 1.3,
                  letterSpacing: '-0.02em',
                }}
              >
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
            sx={{
              backdropFilter: 'blur(8px)',
              backgroundColor: 'rgba(255,255,255,0.55)',
              borderColor: mode === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.70)',
              '&:hover': {
                backgroundColor: 'rgba(255,255,255,0.75)',
              },
            }}
          >
            {t('dashboard.export')}
          </Button>
        </Stack>
      </Box>

      {/* ── KPI card row ── */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(5, 1fr)' },
          gap: 2,
          mb: ROW_GAP,
        }}
      >
        {kpiCards(stats, t, navigate).map((card) => (
          <KpiCard key={card.titleKey} {...card} />
        ))}
      </Box>

      {/* ── Activity (8) + Alerts (4) ── */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'repeat(12, 1fr)' },
          gap: 2,
          mb: ROW_GAP,
        }}
      >
        <Box sx={{ gridColumn: { xs: '1', lg: 'span 8' } }}>
          <FleetActivityChart />
        </Box>
        <Box sx={{ gridColumn: { xs: '1', lg: 'span 4' } }}>
          <ActiveAlertsPanel />
        </Box>
      </Box>

      {/* ── Alert types (4) + Utilization (4) + Performance (4) ── */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'repeat(12, 1fr)' },
          gap: 2,
          mb: ROW_GAP,
        }}
      >
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
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'repeat(12, 1fr)' },
          gap: 2,
          mb: ROW_GAP,
        }}
      >
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

/** KPI card descriptors — Lucide icon + value + label + trend + sparkline. */
function kpiCards(
  s: ReturnType<typeof useFleetStats>['data'] | undefined,
  _t: TFunction,
  _navigate: (p: string) => void,
) {
  return [
    {
      titleKey: 'dashboard.stats.active',
      value: s?.totalActive ?? 0,
      icon: Truck as LucideIcon,
      iconColor: status.success,
      delta: s?.deltas?.totalActive,
      deltaLabel: 'vs yesterday',
      sparkline: s?.sparklines?.totalActive,
    },
    {
      titleKey: 'dashboard.stats.driving',
      value: s?.driving ?? 0,
      icon: Route as LucideIcon,
      iconColor: status.blue,
      delta: s?.deltas?.driving,
      deltaLabel: 'vs yesterday',
      sparkline: s?.sparklines?.driving,
    },
    {
      titleKey: 'dashboard.stats.idle',
      value: s?.idle ?? 0,
      icon: ParkingSquare as LucideIcon,
      iconColor: status.amber,
      delta: s?.deltas?.idle,
      deltaLabel: 'vs yesterday',
      sparkline: s?.sparklines?.idle,
    },
    {
      titleKey: 'dashboard.stats.alerts',
      value: s?.alerts ?? 0,
      icon: Bell as LucideIcon,
      iconColor: status.danger,
      delta: s?.deltas?.alerts,
      deltaLabel: 'vs yesterday',
      sparkline: s?.sparklines?.alerts,
      meta:
        s && s.criticalAlerts > 0 ? (
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
      icon: WifiOff as LucideIcon,
      iconColor: status.slate,
      delta: s?.deltas?.offline,
      deltaLabel: 'vs yesterday',
      sparkline: s?.sparklines?.offline,
    },
  ];
}
