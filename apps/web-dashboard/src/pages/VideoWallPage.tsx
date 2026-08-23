/**
 * VideoWallPage — the TailAdmin operations video hub (`/video`, Phase 7).
 *
 * Three views over the same channel catalog:
 * - WALL: the HikCentral-style video wall (toolbar + dock + grid). Owns the
 *   wall state (division, tile assignments, spotlight, rotation, alerts) and
 *   syncs shareable bits to the URL (`?d=16`, `?spotlight=1`) per 10 §7.4.
 *   The wall's cap+rotate bandwidth model lives in `useWallRotation`; tiles
 *   within the live budget stream, the rest rotate on a 30s cadence.
 * - CAMERAS: the camera/channel management table (status + availability).
 * - PLAYBACK: the recorded-playback shell (honest pending-backend state).
 *
 * Keyboard: `f` toggles whole-wall fullscreen; `1..6` pick the division
 * presets (wall view only). Shortcuts are ignored while typing in inputs.
 */
import { Camera, History, LayoutGrid, Settings } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useChannels, useSaveWall, useVideoWalls } from '@/api/video.api';
import { CamerasPanel } from '@/components/video/CamerasPanel';
import { DeviceConfigWizard } from '@/components/video/DeviceConfigWizard';
import { ChannelDock } from '@/components/video/ChannelDock';
import { PlaybackPanel } from '@/components/video/PlaybackPanel';
import { WallGrid } from '@/components/video/WallGrid';
import { WallToolbar } from '@/components/video/WallToolbar';
import { Button } from '@/components/tailwind-ui';
import { toggleFullscreen } from '@/lib/video-stream';
import { emptyTiles } from '@/mock/video-data';
import { MAX_LIVE_TILES, WALL_DIVISIONS } from '@/types/video.types';
import type { CameraChannel, VideoWall, WallDivision, WallTile } from '@/types/video.types';

type ViewTab = 'wall' | 'cameras' | 'playback';

/** Parse + clamp the division from URL search params. */
function readDivision(params: URLSearchParams): WallDivision {
  const raw = params.get('d');
  const n = raw ? Number.parseInt(raw, 10) : 4;
  if (n === 1 || n === 4 || n === 9 || n === 16 || n === 36 || n === 64) return n;
  return 4;
}

export function VideoWallPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();

  const { data: channelsData, isLoading: channelsLoading } = useChannels();
  const { data: wallsData, isLoading: wallsLoading } = useVideoWalls();
  const saveWall = useSaveWall();
  const channels = channelsData ?? [];

  const viewportRef = useRef<HTMLDivElement | null>(null);

  const [tab, setTab] = useState<ViewTab>(() => {
    const v = params.get('view');
    return v === 'cameras' || v === 'playback' ? v : 'wall';
  });
  const [division, setDivision] = useState<WallDivision>(() => readDivision(params));
  const [tiles, setTiles] = useState<WallTile[]>(() => emptyTiles(readDivision(params)));
  const [spotlightSlot, setSpotlightSlot] = useState<number | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [rotationOn, setRotationOn] = useState(true);
  const [alertSlot, setAlertSlot] = useState<number | null>(null);

  // Keep the URL in sync with the division + spotlight (shareable deep links).
  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('view', tab);
        next.set('d', String(division));
        if (spotlightSlot !== null) next.set('spotlight', String(spotlightSlot));
        else next.delete('spotlight');
        return next;
      },
      { replace: true },
    );
  }, [tab, division, spotlightSlot, setParams]);

  // Resize the tile set when the division changes (preserve assignments where possible).
  const changeDivision = useCallback(
    (d: WallDivision) => {
      setDivision(d);
      setTiles((prev) => {
        const next = emptyTiles(d);
        for (let i = 0; i < Math.min(prev.length, d); i++) {
          next[i] = {
            ...next[i],
            channelId: prev[i]?.channelId ?? null,
            pinned: prev[i]?.pinned ?? false,
          };
        }
        return next;
      });
      if (spotlightSlot !== null && spotlightSlot >= d) setSpotlightSlot(null);
    },
    [spotlightSlot],
  );

  // Assign a channel to the first empty slot (click-to-add from dock/table).
  const pickChannel = useCallback((channel: CameraChannel) => {
    setTab('wall');
    setTiles((prev) => {
      const idx = prev.findIndex((tile) => tile.channelId === null);
      if (idx === -1) return prev; // wall full
      const next = prev.slice();
      next[idx] = { ...next[idx], channelId: channel.id };
      return next;
    });
  }, []);

  const autoFill = useCallback(() => {
    setTiles((prev) => {
      const online = channels.filter((c) => c.online && c.consentGiven);
      let cursor = 0;
      return prev.map((tile) => {
        if (tile.channelId !== null) return tile;
        const ch = online[cursor];
        cursor += 1;
        return ch ? { ...tile, channelId: ch.id } : tile;
      });
    });
  }, [channels]);

  const removeTile = useCallback((slot: number) => {
    setTiles((prev) =>
      prev.map((t) => (t.slot === slot ? { ...t, channelId: null, pinned: false } : t)),
    );
  }, []);

  const togglePin = useCallback(
    (slot: number) => {
      // In spotlight mode, clicking the big tile's pin clears spotlight.
      if (spotlightSlot !== null) {
        setSpotlightSlot(null);
        return;
      }
      setSpotlightSlot(slot);
      setTiles((prev) => prev.map((t) => (t.slot === slot ? { ...t, pinned: true } : t)));
    },
    [spotlightSlot],
  );

  const toggleSpotlight = useCallback(() => {
    setSpotlightSlot((prev) => {
      const next = prev === null ? 0 : null;
      if (next !== null) {
        setTiles((ts) => ts.map((t) => (t.slot === next ? { ...t, pinned: true } : t)));
      }
      return next;
    });
  }, []);

  const fullscreenWall = useCallback(async () => {
    if (viewportRef.current) await toggleFullscreen(viewportRef.current);
  }, []);

  const loadWall = useCallback((wall: VideoWall) => {
    setTab('wall');
    setDivision(wall.division);
    setTiles(wall.tiles);
    setSpotlightSlot(null);
  }, []);

  const saveCurrentWall = useCallback(() => {
    const wall: VideoWall = {
      id: `wall-${Date.now()}`,
      name: `Wall ${division}`,
      division,
      tiles,
    };
    saveWall.mutate(wall);
  }, [division, tiles, saveWall]);

  // Simulate an alert pop-in on a random assigned tile (demo of §9.3).
  const simulateAlert = useCallback(() => {
    const assigned = tiles.filter((t) => t.channelId !== null);
    if (assigned.length === 0) return;
    const pick = assigned[Math.floor(Math.random() * assigned.length)];
    if (!pick) return;
    setAlertSlot(pick.slot);
    // Auto-spotlight the alerting tile for a few seconds.
    setSpotlightSlot(pick.slot);
    setTimeout(() => setAlertSlot(null), 6000);
  }, [tiles]);

  // Keyboard shortcuts: f = fullscreen, 1..6 = division presets (wall view).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (event.key === 'f' || event.key === 'F') {
        void fullscreenWall();
        return;
      }
      if (tab === 'wall') {
        const idx = Number.parseInt(event.key, 10);
        if (idx >= 1 && idx <= WALL_DIVISIONS.length) {
          changeDivision(WALL_DIVISIONS[idx - 1] as WallDivision);
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [tab, fullscreenWall, changeDivision]);

  // Derived counts for the toolbar indicator.
  const assignedCount = useMemo(() => tiles.filter((t) => t.channelId !== null).length, [tiles]);
  const liveCount = useMemo(() => {
    const pinned = tiles.filter((t) => t.pinned && t.channelId !== null).length;
    const budget = Math.max(0, MAX_LIVE_TILES - pinned);
    const nonPinnedAssigned = tiles.filter((t) => t.channelId !== null && !t.pinned).length;
    return pinned + Math.min(budget, nonPinnedAssigned);
  }, [tiles]);

  const empty = assignedCount === 0;

  const tabs = [
    {
      id: 'wall' as const,
      label: t('video.tabs.wall', { defaultValue: 'Wall' }),
      icon: <LayoutGrid size={15} />,
    },
    {
      id: 'cameras' as const,
      label: t('video.tabs.cameras', { defaultValue: 'Cameras' }),
      icon: <Camera size={15} />,
    },
    {
      id: 'playback' as const,
      label: t('video.tabs.playback', { defaultValue: 'Playback' }),
      icon: <History size={15} />,
    },
  ];

  return (
    <div className="absolute inset-0 flex flex-col bg-gray-50 dark:bg-graydark-200">
      {/* View tabs */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-3 py-2 dark:border-white/5 dark:bg-graydark-300">
        <div
          role="tablist"
          aria-label={t('video.title')}
          className="flex items-center gap-1 rounded-xl bg-gray-100 p-1 dark:bg-white/5"
        >
          {tabs.map(({ id, label, icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border-none px-3 py-1.5 text-sm font-semibold transition-colors ${
                tab === id
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-graydark-300 dark:text-white'
                  : 'bg-transparent text-gray-500 hover:text-gray-800 dark:text-graydark-600 dark:hover:text-white'
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
        <span className="hidden text-xs text-gray-400 sm:inline dark:text-graydark-600">
          {t('video.keyboardHint', { defaultValue: 'F: fullscreen · 1-6: layout' })}
        </span>
        <Button size="sm" variant="secondary" leftIcon={<Settings size={14} aria-hidden />} onClick={() => setSetupOpen(true)}>
          {t('video.setup.open')}
        </Button>
      </div>

      {tab === 'wall' && (
        <>
          <WallToolbar
            division={division}
            onDivisionChange={changeDivision}
            spotlightSlot={spotlightSlot}
            onToggleSpotlight={toggleSpotlight}
            onFullscreenWall={fullscreenWall}
            rotationOn={rotationOn}
            onToggleRotation={() => setRotationOn((v) => !v)}
            liveCount={liveCount}
            assignedCount={assignedCount}
            maxLive={MAX_LIVE_TILES}
            walls={wallsData}
            wallsLoading={wallsLoading}
            onLoadWall={loadWall}
            onSaveWall={saveCurrentWall}
            onSimulateAlert={simulateAlert}
          />
          <div className="flex min-h-0 flex-1">
            <ChannelDock channels={channels} onPick={pickChannel} onAutoFill={autoFill} />
            <div ref={viewportRef} className="min-h-0 min-w-0 flex-1 p-2">
              {empty ? (
                <div className="flex h-full flex-col items-center justify-center gap-2">
                  <LayoutGrid size={48} className="text-gray-600" aria-hidden />
                  <p className="text-sm text-gray-500 dark:text-graydark-600">{t('video.empty')}</p>
                  <p className="text-xs text-gray-400 dark:text-graydark-600">
                    {t('video.emptyHelp')}
                  </p>
                </div>
              ) : (
                <WallGrid
                  division={division}
                  tiles={tiles}
                  channels={channels}
                  spotlightSlot={spotlightSlot}
                  alertSlot={alertSlot}
                  rotationOn={rotationOn}
                  onTogglePin={togglePin}
                  onRemove={removeTile}
                />
              )}
            </div>
          </div>
        </>
      )}

      {tab === 'cameras' && (
        <CamerasPanel channels={channels} loading={channelsLoading} onAddToWall={pickChannel} />
      )}

      {tab === 'playback' && <PlaybackPanel channels={channels} />}

      <DeviceConfigWizard open={setupOpen} onClose={() => setSetupOpen(false)} />
    </div>
  );
}
