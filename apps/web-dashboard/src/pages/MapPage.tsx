import { Box, Stack } from '@mui/material';
import { useMemo, useState } from 'react';

import { useMapVehicles } from '@/api/fleet.api';
import { DeviceListPanel } from '@/components/map/DeviceListPanel';
import { DevicePopup } from '@/components/map/DevicePopup';
import { FleetMap } from '@/components/map/FleetMap';
import { MapToolbar } from '@/components/map/MapToolbar';
import type { StatusFilter } from '@/components/map/types';

/**
 * MapPage — the Live Tracking map dashboard (UI_UX_Design.md §2).
 *
 * Full-bleed layout: a collapsible left device panel + the map filling the rest,
 * with a top toolbar overlay and a right slide-over device popup drawer. Owns
 * the shared UI state (selected vehicle, search query, status filter, paused)
 * and derives the filtered fleet that both the list and the map consume.
 *
 * The AppLayout content area adds `p: 3`; this page neutralizes it with a
 * negative margin so the map reaches the edges (§2.2 full-bleed).
 */
export function MapPage() {
  const { data } = useMapVehicles();
  const vehicles = data ?? [];

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

  return (
    <Box
      sx={{
        // Neutralize AppLayout's p:3 so the map is full-bleed (§2.2).
        m: -3,
        height: 'calc(100vh - 56px)',
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
