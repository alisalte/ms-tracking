import { List, Map as MapIcon, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { useFleets, useVehicles } from '@/api/asset.api';
import { useMapVehicles } from '@/api/fleet.api';
import { useGeofences } from '@/api/geofence.api';
import { type HistoryPresetId, fetchMapMatch, presetRange, useVehicleTrack } from '@/api/map.api';
import { useAuthStore } from '@/auth/auth.store';
import { ErrorState } from '@/components/common/ErrorState';
import { DeviceListPanel } from '@/components/map/DeviceListPanel';
import { DevicePopup } from '@/components/map/DevicePopup';
import { FleetMap, type HistoryTrack } from '@/components/map/FleetMap';
import { MapSettingsPanel } from '@/components/map/MapSettingsPanel';
import { type CustomRange, MapToolbar } from '@/components/map/MapToolbar';
import { PlaybackControls } from '@/components/map/PlaybackControls';
import { RoutePlannerDialog } from '@/components/map/RoutePlannerDialog';
import { type PresenceFilter, presenceOf } from '@/components/map/types';
import { useTrackPlayback } from '@/components/map/useTrackPlayback';
import { Button, EmptyState, Spinner } from '@/components/tailwind-ui';
import { mergeLivePositions, useLiveTracking } from '@/hooks/useLiveTracking';
import { type BasemapId, loadPersistedBasemap, persistBasemap } from '@/lib/basemaps';
import { splitTrackIntoSegments } from '@/lib/track-utils';

/** WS connection chip copy per socket state (§2.2; 'error' = backoff retry). */
function wsChip(connectionState: string): {
  labelKey: string;
  tone: 'success' | 'warning' | 'gray';
} {
  switch (connectionState) {
    case 'connected':
      return { labelKey: 'map.ws.connected', tone: 'success' };
    case 'connecting':
      return { labelKey: 'map.ws.connecting', tone: 'gray' };
    case 'error':
      return { labelKey: 'map.ws.reconnecting', tone: 'warning' };
    default:
      return { labelKey: 'map.ws.disconnected', tone: 'gray' };
  }
}

/** Small floating status pill over the map (history status + WS state). */
function MapChip({
  children,
  tone = 'gray',
  onClick,
  testid,
  style,
}: {
  children: React.ReactNode;
  tone?: 'success' | 'warning' | 'danger' | 'gray';
  onClick?: () => void;
  testid?: string;
  style?: React.CSSProperties;
}) {
  const tones = {
    success:
      'bg-success-50 text-success-700 border-success-200 dark:bg-success-500/10 dark:text-success-400 dark:border-success-500/20',
    warning:
      'bg-warning-50 text-warning-700 border-warning-200 dark:bg-warning-500/10 dark:text-warning-400 dark:border-warning-500/20',
    danger:
      'bg-danger-50 text-danger-700 border-danger-200 dark:bg-danger-500/10 dark:text-danger-400 dark:border-danger-500/20',
    gray: 'bg-white/90 text-gray-600 border-gray-200 dark:bg-graydark-300/90 dark:text-graydark-700 dark:border-white/10',
  } as const;
  const cls = `absolute end-2 z-10 inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold shadow-sm backdrop-blur-sm ${tones[tone]}`;
  // Interactive chips (retry-on-error) render as buttons for keyboard a11y.
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid={testid}
        style={style}
        className={`${cls} cursor-pointer`}
      >
        {children}
      </button>
    );
  }
  return (
    <span data-testid={testid} style={style} className={cls}>
      {children}
    </span>
  );
}

/**
 * MapPage — the Live Tracking map dashboard (UI_UX_Design.md §12–§20).
 *
 * Full-bleed layout: a collapsible left device panel + the map filling the rest,
 * with a top toolbar overlay and a right slide-over device popup drawer. The
 * map itself is ALWAYS mounted — loading/error/empty fleet states render as
 * centered overlays over the tiles, never as page replacements. Owns
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
  // Live follow (§2.5 دنبال‌کردن): the map re-centers on the selected vehicle
  // while active; cleared when the selection changes or the drawer closes.
  const [following, setFollowing] = useState(false);
  const [query, setQuery] = useState('');
  const [presence, setPresence] = useState<PresenceFilter>('all');
  const [fleetId, setFleetId] = useState<string>('all');
  const [paused, setPaused] = useState(false);

  // ── Map display settings (separate from the tracking toolbar) ──
  // Basemap style, persisted per browser. The tile swap itself happens in
  // FleetMap; this state is the single source of truth for the settings panel.
  const [basemap, setBasemap] = useState<BasemapId>(loadPersistedBasemap);
  useEffect(() => {
    persistBasemap(basemap);
  }, [basemap]);

  // ── Sprint F §20: LIVE vs HISTORY mode ──
  // LIVE merges WebSocket deltas; HISTORY queries the real track for the
  // selected vehicle + a bounded window (preset OR custom — Sprint I §29/§30).
  // The data models are never mixed: in history mode the live WS merge is
  // bypassed. Deep link (?vehicle&from&to) preselects history (§37 trip→map).
  const [mode, setMode] = useState<'live' | 'history'>(() => {
    const vehicleParam = searchParams.get('vehicle');
    return vehicleParam && (searchParams.get('from') || searchParams.get('to'))
      ? 'history'
      : 'live';
  });
  const [historyPreset, setHistoryPreset] = useState<HistoryPresetId | 'custom'>('24h');
  const [customRange, setCustomRange] = useState<CustomRange | null>(null);
  const [routePlannerOpen, setRoutePlannerOpen] = useState(false);
  // Mobile roster: below md the roster becomes a slide-in overlay (§ responsive).
  const [rosterOpen, setRosterOpen] = useState(false);
  const [routeGeometry, setRouteGeometry] = useState<ReadonlyArray<{
    lat: number;
    lng: number;
  }> | null>(null);

  // Active tenant geofences — context overlay on the live map (dashed brand
  // outlines). Optional context: a failed fetch renders no fences (the map
  // itself still errors honestly through its own queries).
  const { data: geofencesData } = useGeofences();

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
  const [matchedPoints, setMatchedPoints] = useState<
    | readonly {
        latitude: number;
        longitude: number;
        confidence: number;
      }[]
    | null
  >(null);
  const [matchingUnavailable, setMatchingUnavailable] = useState(false);

  useEffect(() => {
    setMatchedPoints(null);
    setMatchingUnavailable(false);
    if (!mapMatching || !trackQuery.data || trackQuery.data.length < 2) return;
    let cancelled = false;
    void fetchMapMatch(trackQuery.data.map((p) => ({ lat: p.latitude, lng: p.longitude })))
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
      return snapped ? { ...p, latitude: snapped.latitude, longitude: snapped.longitude } : p;
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
    setFollowing(false);
    setPopupOpen(true);
    setFocus((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  // vehicleId → fleetId join (registry) for the §20 fleet filter.
  const fleetOfVehicle = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of registryVehicles ?? []) m.set(v.id, v.fleetId);
    return m;
  }, [registryVehicles]);

  // vehicleId → fleet NAME resolver for the list-card subtitle (registry join;
  // falls back to the i18n "no fleet" caption when the vehicle is not in the
  // registry yet).
  const fleetNameOf = useMemo(() => {
    const names = new Map<string, string>((fleetsData ?? []).map((f) => [f.id, f.name] as const));
    return (vehicleId: string): string | undefined =>
      names.get(fleetOfVehicle.get(vehicleId) ?? '');
  }, [fleetsData, fleetOfVehicle]);

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

  // The map is ALWAYS mounted — loading/error/empty never replace the page;
  // each state renders as a centered, non-blocking overlay over the tiles so
  // the user can still pan/zoom (and deep links keep working) while the
  // fleet data settles.
  const showLoadingOverlay = isLoading;
  const showErrorOverlay = !isLoading && isError;
  const showEmptyOverlay = !isLoading && !isError && vehicles.length === 0;

  const chip = wsChip(connectionState);

  return (
    // Tailwind-only scope — the map's side surfaces (device roster, settings)
    // are ported onto the shared design system with the app's brand palette,
    // color mode, and direction handled by ThemeRegistry + logical utilities.
    <div
      // Full-bleed: break out of <main>'s padding by going absolute.
      // The AppLayout <main> is position:relative, so inset:0 covers the
      // padding box edge-to-edge regardless of box-sizing quirks.
      className="absolute inset-0 overflow-hidden"
    >
      {/* ── Background: the map fills the whole viewport; the roster floats
            over it as a frosted glass column (start side) so the fleet is
            never cut off from the map canvas. Below md it becomes a slide-in
            overlay toggled by the floating roster button (§ responsive). ── */}
      {rosterOpen && (
        <button
          type="button"
          aria-label={t('map.roster.close')}
          onClick={() => setRosterOpen(false)}
          className="absolute inset-0 z-[19] bg-black/30 md:hidden"
        />
      )}
      <div
        className={`absolute inset-y-3 start-3 z-20 flex w-[86vw] max-w-[300px] flex-col transition-transform duration-200 md:w-[300px] md:translate-x-0 ${
          rosterOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full'
        }`}
      >
        <DeviceListPanel
          vehicles={filtered}
          total={vehicles.length}
          query={query}
          presence={presence}
          counts={counts}
          fleets={fleetsData ?? []}
          fleetId={fleetId}
          fleetNameOf={fleetNameOf}
          selectedId={selectedId}
          onQueryChange={setQuery}
          onPresenceChange={setPresence}
          onFleetChange={setFleetId}
          onSelect={selectFromList}
        />
      </div>

      {/* ── Center: map + toolbar overlay (full background) ── */}
      <div className="absolute inset-0">
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
          <MapChip style={{ top: 92 }}>{t('map.history.loading')}</MapChip>
        )}
        {mode === 'history' && selectedId && trackQuery.isError && (
          <MapChip tone="danger" onClick={() => trackQuery.refetch()} style={{ top: 92 }}>
            {t('map.history.error')}
          </MapChip>
        )}
        {mode === 'history' && selectedId && !trackQuery.isLoading && !trackQuery.isError && (
          <MapChip style={{ top: 92 }}>
            {t('map.history.points', { count: trackQuery.data?.length ?? 0 })}
          </MapChip>
        )}
        {/* Sprint I §39 — explicit fallback indicator; the raw track is NOT
            presented as map-matched. */}
        {mode === 'history' && mapMatching && matchingUnavailable && (
          <MapChip tone="warning" testid="map-matching-unavailable" style={{ top: 120 }}>
            {t('map.matching.unavailable')}
          </MapChip>
        )}
        {/* Live WS connection state (§2.2): Connected / Connecting / Reconnecting / Disconnected. */}
        <MapChip tone={chip.tone} style={{ top: 60 }} onClick={undefined}>
          {t(chip.labelKey)}
        </MapChip>
        <div className="absolute inset-0">
          <FleetMap
            vehicles={filtered}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setFollowing(false);
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
            followId={following && selectedId ? selectedId : null}
            basemap={basemap}
            geofences={geofencesData ?? []}
          />
        </div>
        {/* Map display settings (basemap modes) — a control SEPARATE from the
         * tracking toolbar: floating button + popover at the bottom-start,
         * lifted above the playback transport while history playback runs. */}
        <MapSettingsPanel
          basemap={basemap}
          onBasemapChange={setBasemap}
          raised={mode === 'history' && displayPoints != null && displayPoints.length >= 2}
        />
        {/* Mobile roster toggle (below md the roster is a slide-in overlay). */}
        <button
          type="button"
          onClick={() => setRosterOpen((o) => !o)}
          aria-label={rosterOpen ? t('map.roster.close') : t('map.roster.open')}
          aria-expanded={rosterOpen}
          data-testid="map-roster-toggle"
          className="absolute bottom-3 end-3 z-30 inline-flex size-10 cursor-pointer items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 shadow-lg transition-colors hover:bg-gray-50 md:hidden dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-700 dark:hover:bg-white/10"
        >
          {rosterOpen ? <X size={18} aria-hidden /> : <List size={18} aria-hidden />}
        </button>
        {/* Always-on-map state overlays (loading / error / no vehicles yet).
         * The wrapper is pointer-transparent so pan/zoom keep working; only
         * the card itself captures clicks (retry button, CTA link). */}
        {(showLoadingOverlay || showErrorOverlay || showEmptyOverlay) && (
          <div
            data-testid="map-state-overlay"
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6"
          >
            <div className="pointer-events-auto max-w-sm rounded-2xl border border-gray-200 bg-white/95 px-6 py-4 shadow-lg backdrop-blur-sm dark:border-white/10 dark:bg-graydark-300/95">
              {showLoadingOverlay && <Spinner size="lg" label={t('common.loading')} />}
              {showErrorOverlay && <ErrorState error={error} onRetry={() => refetch()} />}
              {showEmptyOverlay && (
                <EmptyState
                  icon={<MapIcon />}
                  title={t('map.emptyTitle')}
                  description={t('map.emptyHelp')}
                  action={
                    <Link to="/assets">
                      <Button variant="primary" size="sm" data-testid="map-empty-cta">
                        {t('map.emptyCta')}
                      </Button>
                    </Link>
                  }
                />
              )}
            </div>
          </div>
        )}
        {/* Sprint I §32/§33 — playback transport + timeline (history mode only). */}
        {mode === 'history' && displayPoints && displayPoints.length >= 2 && (
          <PlaybackControls playback={playback} />
        )}
      </div>

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
        following={following}
        onToggleFollow={() => setFollowing((f) => !f)}
      />
    </div>
  );
}
