import { Box, Button, Card, CardContent, Skeleton, Stack } from '@mui/material';
import {
  Cpu,
  Download,
  HelpCircle,
  History,
  Layers,
  type LucideIcon,
  Truck,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useFleetStats } from '@/api/fleet.api';
import { ErrorState } from '@/components/common/ErrorState';
import { useThemeContext } from '@/theme/ThemeRegistry';
import { glass, status } from '@/theme/palette';

import { ActiveAlertsPanel } from './ActiveAlertsPanel';
import { AlertTypeBreakdownChart } from './AlertTypeBreakdownChart';
import { FleetMapPreview } from './FleetMapPreview';
import { KpiCard } from './KpiCard';
import { LiveBadge } from './LiveBadge';

/** Section gap between dashboard rows. */
const ROW_GAP = 2.25;

/** A stat-card descriptor — REAL counts only, no fabricated deltas/sparklines. */
interface StatCardSpec {
  titleKey: string;
  value: number;
  icon: LucideIcon;
  iconColor: string;
}

/**
 * DashboardGrid — the Fleet Dashboard on REAL backend data (Sprint E §21).
 *
 * Layout:
 * 1. Page header: title + subtitle + live badge + export, set against an aurora
 *    gradient banner with floating colored blobs.
 * 2. KPI row — the §21 minimum (Total Vehicles, Online, Offline, Stale, Unknown)
 *    from fleet-management GET /summary × gps-engine device statuses, plus two
 *    honest extras (Fleets, Devices) from the same summary.
 * 3. Two-column grid: Active Alerts (wide) + Alert Types (narrow) — both from
 *    the real notification-service, with honest error/empty states.
 * 4. Full-width Fleet Map Preview (registry × status × position join).
 *
 * Widgets that have no backend (24h activity, utilization, performance,
 * attention list, weather) were removed rather than faked (§22).
 */
export function DashboardGrid() {
  const { t } = useTranslation();
  const { mode } = useThemeContext();
  const { data: stats, isLoading, isError, error, refetch } = useFleetStats();

  const pageGradient = mode === 'dark' ? glass.pageGradientDark : glass.pageGradientLight;

  // §21 stat row — real counts; secondary registry counts rendered as smaller cards.
  const primaryCards: StatCardSpec[] = [
    {
      titleKey: 'dashboard.stats.totalVehicles',
      value: stats?.totalVehicles ?? 0,
      icon: Truck,
      iconColor: status.blue,
    },
    {
      titleKey: 'dashboard.stats.online',
      value: stats?.online ?? 0,
      icon: Wifi,
      iconColor: status.success,
    },
    {
      titleKey: 'dashboard.stats.offline',
      value: stats?.offline ?? 0,
      icon: WifiOff,
      iconColor: status.slate,
    },
    {
      titleKey: 'dashboard.stats.stale',
      value: stats?.stale ?? 0,
      icon: History,
      iconColor: status.amber,
    },
    {
      titleKey: 'dashboard.stats.unknown',
      value: stats?.unknown ?? 0,
      icon: HelpCircle,
      iconColor: status.slate,
    },
  ];
  const secondaryCards: StatCardSpec[] = [
    {
      titleKey: 'dashboard.stats.fleets',
      value: stats?.totalFleets ?? 0,
      icon: Layers,
      iconColor: status.indigo,
    },
    {
      titleKey: 'dashboard.stats.devices',
      value: stats?.totalDevices ?? 0,
      icon: Cpu,
      iconColor: status.teal,
    },
  ];

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

      {/* ── KPI card row (§21) ── */}
      {isError ? (
        <Card
          className="fv-glass"
          sx={{ mb: ROW_GAP, borderRadius: glass.radius, backgroundColor: 'transparent' }}
        >
          <CardContent>
            <ErrorState error={error} onRetry={() => void refetch()} />
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, 1fr)',
              sm: 'repeat(3, 1fr)',
              md: 'repeat(5, 1fr)',
            },
            gap: 2,
            mb: ROW_GAP,
          }}
        >
          {['total', 'online', 'offline', 'stale', 'unknown'].map((slot) => (
            <Card key={slot} className="fv-glass" sx={{ borderRadius: glass.radius }}>
              <CardContent sx={{ p: 2 }}>
                <Skeleton variant="rounded" width={46} height={46} sx={{ mb: 1.5 }} />
                <Skeleton variant="text" width="60%" />
                <Skeleton variant="text" width={72} height={40} />
              </CardContent>
            </Card>
          ))}
        </Box>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, 1fr)',
              sm: 'repeat(3, 1fr)',
              md: 'repeat(5, 1fr)',
            },
            gap: 2,
            mb: ROW_GAP,
          }}
        >
          {primaryCards.map((card) => (
            <KpiCard key={card.titleKey} {...card} />
          ))}
        </Box>
      )}

      {/* ── Registry extras: Fleets + Devices (secondary, same /summary source) ── */}
      {!isError && !isLoading && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
            gap: 2,
            mb: ROW_GAP,
          }}
        >
          {secondaryCards.map((card) => (
            <KpiCard key={card.titleKey} {...card} />
          ))}
        </Box>
      )}

      {/* ── Alerts (8) + Alert types (4) ── */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'repeat(12, 1fr)' },
          gap: 2,
          mb: ROW_GAP,
        }}
      >
        <Box sx={{ gridColumn: { xs: '1', lg: 'span 8' } }}>
          <ActiveAlertsPanel />
        </Box>
        <Box sx={{ gridColumn: { xs: '1', lg: 'span 4' } }}>
          <AlertTypeBreakdownChart />
        </Box>
      </Box>

      {/* ── Map preview (full width) ── */}
      <Box>
        <FleetMapPreview />
      </Box>
    </Box>
  );
}
