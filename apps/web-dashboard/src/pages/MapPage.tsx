import { Map as MapIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useFleets, useVehicles } from '@/api/asset.api';
import { useMapVehicles } from '@/api/fleet.api';
import {
  type HistoryPresetId,
  fetchMapMatch,
  presetRange,
  useVehicleTrack,
} from '@/api/map.api';
import { useAuthStore } from '@/auth/auth.store';
import { ErrorState } from '@/components/common/ErrorState';
import { DeviceListPanel } from '@/components/map/DeviceListPanel';
import { DevicePopup } from '@/components/map/DevicePopup';
import { FleetMap, type HistoryTrack } from '@/components/map/FleetMap';
import { MapToolbar, type CustomRange } from '@/components/map/MapToolbar';
import { PlaybackControls } from '@/components/map/PlaybackControls';
import { useTrackPlayback } from '@/components/map/useTrackPlayback';
import { RoutePlannerDialog } from '@/components/map/RoutePlannerDialog';
import { type PresenceFilter, presenceOf } from '@/components/map/types';
import { mergeLivePositions, useLiveTracking } from '@/hooks/useLiveTracking';
import { splitTrackIntoSegments } from '@/lib/track-utils';
import { Box, Chip, CircularProgress, Stack, Typography } from '@mui/material';

/** WS connection chip copy per socket state (§2.2; 'error' = backoff retry). */
function wsChip(connectionState: string): {
  labelKey: string;
  color: 'success' | 'warning' | 'default';
  variant: 'filled' | 'outlined';
} {
  switch (connectionState) {
    case 'connected':
      return { labelKey: 'map.ws.connected', color: 'success', variant: 'filled' };
    case 'connecting':
      return { labelKey: 'map.ws.connecting', color: 'default', variant: 'outlined' };
    case 'error':
      return { labelKey: 'map.ws.reconnecting', color: 'warning', variant: 'outlined' };
    default:
      return { labelKey: 'map.ws.disconnected', color: 'default', variant: 'outlined' };
  }
}

/**
 * MapPage — the Live Tracking map dashboard (UI_UX_Design.md §12–§20).
 *
 * Full-bleed layout: a collapsible left device panel + the map filling the rest,
 * with a top toolbar overlay and a right slide-over device popup drawer. Owns
 * the shared UI state (selected vehicle, search query, presence/fleet filters,
 * paused) and derives the filtered fleet that both the list and the map consume.
 *
 * Sprint E real data: the base layer is `useMapVehicles` (registry × device
 * status × latest position); the gps-engine WebSocket then streams
 * position.update + device.status deltas which are merged in (latest-wins per
 * vehicleId, §32). Presence (§18) and last-seen (§19) come from the real
 * status records — never fabricated. §17: list ↔ map selection is bidirectional
 * (row click flies the map, marker click selects the row + opens the drawer).
 *
 * Sprint I: HISTORY mode supports a CUSTOM from/to date-time range (§29),
 * real playback with a transport + timeline (§32/§33), and best-effort OSRM
 * map matching with an explicit unavailable fallback (§38/§39). Deep links:
 * `/map?vehicle=<id>&from=<iso>&to=<iso>` preselect history (trips → map, §37).
 */
export function MapPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError, error, refetch } = useMapVehicles();
  const tenantId = useAuthStore((s) => s.tenantId);
  const [searchParams] = useSearchParams();

  // §20 filters: fleet registry for the Fleet selector + the vehicle↔fleet join.
  const { data: fleetsData } = useFleets();
  const { data: registryVehicles } = useVehicles();

  // Live tracking: subscribe to gps-engine WS for real-time position +
  // device-status updates. The hook is a no-op when the WS server is
  // unreachable (dev), so the REST bootstrap below stays the source of truth.
  const { positions, statuses, connectionState } = useLiveTracking(tenantId);

  // Merge live deltas into the REST-fetched vehicles (live overrides REST).
  const vehicles = useMemo(() => {
    const rest = data ?? [];
    return positions.size > 0 || statuses.size > 0
      ? mergeLivePositions(rest, positions, statuses)
      : rest;
  }, [data, positions, statuses]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Sprint I §31: the device popup is a transient INSPECTOR — closing it must
  // not clear the selection (history playback keeps running for the selected
  // vehicle; previously the modal drawer blocked the toolbar until the
  // selection itself was dropped).
  const [popupOpen, setPopupOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [presence, setPresence] = useState<PresenceFilter>('all');
  const [fleetId, setFleetId] = useState<string>('all');
  const [paused, setPaused] = useState(false);

  // ── Sprint F §20: LIVE vs HISTORY mode ──
  // LIVE merges WebSocket deltas; HISTORY queries the real track for the
  // selected vehicle + a bounded window (preset OR custom — Sprint I §29/§30).
  // The data models are never mixed: in history mode the live WS merge is
  // bypassed. Deep link (?vehicle&from&to) preselects history (§37 trip→map).
  const [mode, setMode] = useState<'live' | 'history'>(() => {
    const vehicleParam = searchParams.get('vehicle');
    return vehicleParam && (searchParams.get('from') || searchParams.get('to')) ? 'history' : 'live';
  });
  const [historyPreset, setHistoryPreset] = useState<HistoryPresetId | 'custom'>('24h');
  const [customRange, setCustomRange] = useState<CustomRange | null>(null);
  const [routePlannerOpen, setRoutePlannerOpen] = useState(false);
  const [routeGeometry, setRouteGeometry] = useState<ReadonlyArray<{
    lat: number;
    lng: number;
  }> | null>(null);

  // Deep-link preselection (?vehicle=…&from=…&to=…) — trip → map (§37).
  useEffect(() => {
    const vehicleParam = searchParams.get('vehicle');
    if (!vehicleParam) return;
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if (from && to && new Date(from) < new Date(to)) {
      setCustomRange({ from, to });
      setHistoryPreset('custom');
    }
    setSelectedId(vehicleParam);
    setPopupOpen(false); // deep link targets the TRACK, not the inspector
    setMode('history');
  }, [searchParams]);

  const historyWindow = useMemo(
    () =>
      historyPreset === 'custom' && customRange
        ? customRange
        : historyPreset === 'custom'
          ? presetRange('24h')
          : presetRange(historyPreset),
    [historyPreset, customRange],
  );
  const trackQuery = useVehicleTrack(
    selectedId,
    historyWindow.from,
    historyWindow.to,
    mode === 'history',
  );

  // ── Sprint I §38/§39: map matching (best-effort, explicit fallback) ──
  const [mapMatching, setMapMatching] = useState(false);
  const [matchedPoints, setMatchedPoints] = useState<readonly {
    latitude: number;
    longitude: number;
    confidence: number;
  }[] | null>(null);
  const [matchingUnavailable, setMatchingUnavailable] = useState(false);

  useEffect(() => {
    setMatchedPoints(null);
    setMatchingUnavailable(false);
    if (!mapMatching || !trackQuery.data || trackQuery.data.length < 2) return;
    let cancelled = false;
    void fetchMapMatch(
      trackQuery.data.map((p) => ({ lat: p.latitude, lng: p.longitude })),
    )
      .then((snapped) => {
        if (!cancelled) setMatchedPoints(snapped);
      })
      .catch(() => {
        // Controlled fallback (Sprint I §39): OSRM absent/unreachable/invalid →
        // raw GPS track + an explicit "unavailable" indicator. NEVER claim the
        // raw track is map-matched.
        if (!cancelled) {
          setMatchedPoints(null);
          setMatchingUnavailable(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mapMatching, trackQuery.data]);

  const displayPoints = useMemo(() => {
    const raw = trackQuery.data;
    if (!raw) return null;
    if (!matchedPoints || matchedPoints.length !== raw.length) return raw;
    return raw.map((p, i) => {
      const snapped = matchedPoints[i];
      return snapped
        ? { ...p, latitude: snapped.latitude, longitude: snapped.longitude }
        : p;
    });
  }, [trackQuery.data, matchedPoints]);

  const track: HistoryTrack | null = useMemo(() => {
    if (mode !== 'history' || !displayPoints) return null;
    return { segments: splitTrackIntoSegments(displayPoints), key: 1 };
  }, [mode, displayPoints]);

  // ── Sprint I §32–§35: playback over the loaded (bounded) dataset ──
  const playback = useTrackPlayback(displayPoints ?? []);
  const playbackHead =
    mode === 'history' && displayPoints && displayPoints.length > 0
      ? playback.sample
        ? { lat: playback.sample.lat, lng: playback.sample.lng, heading: playback.sample.heading }
        : null
      : null;

  // ── Deep-link + selection sync ──
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const selectFromList = useCallback((id: string) => {
    setSelectedId(id);
    setPopupOpen(true);
    setFocus((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  // vehicleId → fleetId join (registry) for the §20 fleet filter.
  const fleetOfVehicle = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of registryVehicles ?? []) m.set(v.id, v.fleetId);
    return m;
  }, [registryVehicles]);

  // Counts per presence facet for the filter-chip badges (§18).
  const counts = useMemo(() => {
    const c: Record<PresenceFilter, number> = {
      all: vehicles.length,
      ONLINE: 0,
      OFFLINE: 0,
      STALE: 0,
      UNKNOWN: 0,
    };
    for (const v of vehicles) c[presenceOf(v)] += 1;
    return c;
  }, [vehicles]);

  // Filtered fleet (search + presence + fleet) shared by the list and the map.
  // Server authorization is inherent — the backend only returns this tenant's
  // vehicles; filtering here is pure UX.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vehicles.filter((v) => {
      if (presence !== 'all' && presenceOf(v) !== presence) return false;
      if (fleetId !== 'all' && fleetOfVehicle.get(v.id) !== fleetId) return false;
      if (!q) return true;
      // Search over label/plate (label IS the plate when one exists).
      return v.label.toLowerCase().includes(q);
    });
  }, [vehicles, query, presence, fleetId, fleetOfVehicle]);

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
        <Typography variant="h6">{t('map.emptyTitle')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t('map.emptyHelp')}
        </Typography>
      </Stack>
    );
  }

  const chip = wsChip(connectionState);

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
          presence={presence}
          counts={counts}
          fleets={fleetsData ?? []}
          fleetId={fleetId}
          selectedId={selectedId}
          onQueryChange={setQuery}
          onPresenceChange={setPresence}
          onFleetChange={setFleetId}
          onSelect={selectFromList}
        />
      </Stack>

      {/* ── Center: map + toolbar overlay ── */}
      <Box sx={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <MapToolbar
          visibleCount={filtered.length}
          total={vehicles.length}
          paused={paused}
          onTogglePause={() => setPaused((p) => !p)}
          mode={mode}
          onModeChange={setMode}
          historyPreset={historyPreset}
          onHistoryPresetChange={setHistoryPreset}
          customRange={customRange}
          onCustomRangeChange={setCustomRange}
          hasSelection={selectedId !== null}
          onOpenRoutePlanner={() => setRoutePlannerOpen(true)}
          mapMatching={mapMatching}
          onMapMatchingChange={setMapMatching}
        />
        {/* History mode states (§22/§24): loading / error / no data. */}
        {mode === 'history' && selectedId && trackQuery.isLoading && (
          <Chip
            size="small"
            label={t('map.history.loading')}
            sx={{ position: 'absolute', top: 92, right: 8, zIndex: 10 }}
          />
        )}
        {mode === 'history' && selectedId && trackQuery.isError && (
          <Chip
            size="small"
            color="error"
            label={t('map.history.error')}
            onClick={() => trackQuery.refetch()}
            sx={{ position: 'absolute', top: 92, right: 8, zIndex: 10 }}
          />
        )}
        {mode === 'history' && selectedId && !trackQuery.isLoading && !trackQuery.isError && (
          <Chip
            size="small"
            label={t('map.history.points', { count: trackQuery.data?.length ?? 0 })}
            sx={{ position: 'absolute', top: 92, right: 8, zIndex: 10 }}
          />
        )}
        {/* Sprint I §39 — explicit fallback indicator; the raw track is NOT
            presented as map-matched. */}
        {mode === 'history' && mapMatching && matchingUnavailable && (
          <Chip
            size="small"
            color="warning"
            label={t('map.matching.unavailable')}
            sx={{ position: 'absolute', top: 120, right: 8, zIndex: 10 }}
            data-testid="map-matching-unavailable"
          />
        )}
        {/* Live WS connection state (§2.2): Connected / Connecting / Reconnecting / Disconnected. */}
        <Chip
          size="small"
          label={t(chip.labelKey)}
          color={chip.color}
          variant={chip.variant}
          aria-label={t('map.ws.ariaLabel')}
          sx={{ position: 'absolute', top: 60, right: 8, zIndex: 10 }}
        />
        <Box sx={{ position: 'absolute', inset: 0 }}>
          <FleetMap
            vehicles={filtered}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setPopupOpen(true);
            }}
            onDeselect={() => {
              setSelectedId(null);
              setPopupOpen(false);
            }}
            paused={paused || mode === 'history'}
            focus={focus}
            track={
              track ??
              (routeGeometry
                ? {
                    segments: [routeGeometry.map((p) => [p.lng, p.lat] as [number, number])],
                    key: 1,
                  }
                : null)
            }
            playbackHead={playbackHead}
          />
        </Box>
        {/* Sprint I §32/§33 — playback transport + timeline (history mode only). */}
        {mode === 'history' && displayPoints && displayPoints.length >= 2 && (
          <PlaybackControls playback={playback} />
        )}
      </Box>

      {/* ── Route planner (Sprint F §12) ── */}
      <RoutePlannerDialog
        open={routePlannerOpen}
        onClose={() => setRoutePlannerOpen(false)}
        onRoute={(geometry) => setRouteGeometry(geometry)}
      />

      {/* ── Right: device popup drawer ── */}
      <DevicePopup
        vehicleId={popupOpen ? selectedId : null}
        onClose={() => setPopupOpen(false)}
        onShowHistory={() => setMode('history')}
      />
    </Box>
  );
}
