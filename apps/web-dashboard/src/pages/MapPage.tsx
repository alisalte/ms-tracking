import { Map as MapIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMapVehicles } from '@/api/fleet.api';
import { useAuthStore } from '@/auth/auth.store';
import { ErrorState } from '@/components/common/ErrorState';
import { DeviceListPanel } from '@/components/map/DeviceListPanel';
import { DevicePopup } from '@/components/map/DevicePopup';
import { FleetMap } from '@/components/map/FleetMap';
import { MapToolbar } from '@/components/map/MapToolbar';
import type { StatusFilter } from '@/components/map/types';
import { mergeLivePositions, useLiveTracking } from '@/hooks/useLiveTracking';
import { Box, Chip, CircularProgress, Stack, Typography } from '@mui/material';

/**
 * MapPage — the Live Tracking map dashboard (UI_UX_Design.md §2).
 *
 * Full-bleed layout: a collapsible left device panel + the map filling the rest,
 * with a top toolbar overlay and a right slide-over device popup drawer. Owns
 * the shared UI state (selected vehicle, search query, status filter, paused)
 * and derives the filtered fleet that both the list and the map consume.
 *
 * Includes loading skeleton, error state, and empty state (FE-03).
 */
export function MapPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError, error, refetch } = useMapVehicles();
  const tenantId = useAuthStore((s) => s.tenantId);

  // Live tracking: subscribe to gps-engine WS for real-time position updates.
  // The hook is a no-op when the WS server is unreachable (dev), so the REST
  // fallback below is the source of truth until live data arrives.
  const { positions, connectionState } = useLiveTracking(tenantId);

  // Merge live positions into the REST-fetched vehicles (live overrides REST).
  const vehicles = useMemo(() => {
    const rest = data ?? [];
    return positions.size > 0 ? mergeLivePositions(rest, positions) : rest;
  }, [data, positions]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [paused, setPaused] = useState(false);

  // Counts per status facet for the filter-chip badges.
  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: vehicles.length,
      driving: 0,
      idle: 0,
      overspeed: 0,
      offline: 0,
      stopped: 0,
    };
    for (const v of vehicles) c[v.state] = (c[v.state] ?? 0) + 1;
    return c;
  }, [vehicles]);

  // Filtered fleet (search + status) shared by the list and the map.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vehicles.filter((v) => {
      if (status !== 'all' && v.state !== status) return false;
      if (!q) return true;
      return (
        v.label.toLowerCase().includes(q) ||
        v.id.toLowerCase().includes(q) ||
        (v.driver?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [vehicles, query, status]);

  // ── Loading state ──
  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  // ── Error state ──
  if (isError) {
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }

  // ── Empty state ──
  if (vehicles.length === 0) {
    return (
      <Stack alignItems="center" justifyContent="center" gap={2} sx={{ py: 8 }}>
        <MapIcon size={48} color="#64748B" />
        <Typography variant="h6">{t('map.noResults')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t('map.emptyHelp', { defaultValue: 'No vehicles are being tracked yet.' })}
        </Typography>
      </Stack>
    );
  }

  return (
    <Box
      sx={{
        // Full-bleed: break out of <main>'s padding by going absolute.
        // The AppLayout <main> is position:relative, so inset:0 covers the
        // padding box edge-to-edge regardless of box-sizing quirks.
        position: 'absolute',
        inset: 0,
        display: 'flex',
        overflow: 'hidden',
      }}
    >
      {/* ── Left: device list panel ── */}
      <Stack
        sx={{
          width: 300,
          flexShrink: 0,
          display: { xs: 'none', md: 'flex' },
        }}
      >
        <DeviceListPanel
          vehicles={filtered}
          total={vehicles.length}
          query={query}
          status={status}
          counts={counts}
          selectedId={selectedId}
          onQueryChange={setQuery}
          onStatusChange={setStatus}
          onSelect={setSelectedId}
        />
      </Stack>

      {/* ── Center: map + toolbar overlay ── */}
      <Box sx={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <MapToolbar
          visibleCount={filtered.length}
          total={vehicles.length}
          paused={paused}
          onTogglePause={() => setPaused((p) => !p)}
        />
        {/* Live WS connection indicator (connected = green, else amber/grey). */}
        <Chip
          size="small"
          label={
            connectionState === 'connected'
              ? 'Live'
              : connectionState === 'connecting'
                ? 'Connecting…'
                : 'Live off'
          }
          color={connectionState === 'connected' ? 'success' : 'default'}
          variant={connectionState === 'connected' ? 'filled' : 'outlined'}
          sx={{ position: 'absolute', top: 8, right: 8, zIndex: 10 }}
        />
        <Box sx={{ position: 'absolute', inset: 0 }}>
          <FleetMap
            vehicles={filtered}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDeselect={() => setSelectedId(null)}
            paused={paused}
          />
        </Box>
      </Box>

      {/* ── Right: device popup drawer ── */}
      <DevicePopup vehicleId={selectedId} onClose={() => setSelectedId(null)} />
    </Box>
  );
}
