/**
 * VideoWallPage — the HikCentral-style operations video wall (`/video`).
 *
 * Layout: WallToolbar (top) + ChannelDock (left) + WallGrid (fill). Owns the
 * wall state (division, tile assignments, spotlight, rotation, alerts) and
 * syncs shareable bits to the URL (`?d=16`, `?spotlight=1`) per 10 §7.4.
 *
 * The wall's cap+rotate bandwidth model lives in `useWallRotation`; tiles
 * within the live budget stream, the rest rotate on a 30s cadence.
 */
import { LayoutGrid } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useChannels, useSaveWall, useVideoWalls } from '@/api/video.api';
import { ChannelDock } from '@/components/video/ChannelDock';
import { WallGrid } from '@/components/video/WallGrid';
import { WallToolbar } from '@/components/video/WallToolbar';
import { toggleFullscreen } from '@/lib/video-stream';
import { emptyTiles } from '@/mock/video-data';
import { MAX_LIVE_TILES } from '@/types/video.types';
import type { CameraChannel, VideoWall, WallDivision, WallTile } from '@/types/video.types';
import { Box, Stack, Typography } from '@mui/material';

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

  const { data: channelsData } = useChannels();
  const { data: wallsData, isLoading: wallsLoading } = useVideoWalls();
  const saveWall = useSaveWall();
  const channels = channelsData ?? [];

  const viewportRef = useRef<HTMLDivElement | null>(null);

  const [division, setDivision] = useState<WallDivision>(() => readDivision(params));
  const [tiles, setTiles] = useState<WallTile[]>(() => emptyTiles(readDivision(params)));
  const [spotlightSlot, setSpotlightSlot] = useState<number | null>(null);
  const [rotationOn, setRotationOn] = useState(true);
  const [alertSlot, setAlertSlot] = useState<number | null>(null);

  // Keep the URL in sync with the division + spotlight (shareable deep links).
  // Uses the functional updater so the effect doesn't depend on `params`
  // (which would loop, since setParams changes params).
  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('d', String(division));
        if (spotlightSlot !== null) next.set('spotlight', String(spotlightSlot));
        else next.delete('spotlight');
        return next;
      },
      { replace: true },
    );
  }, [division, spotlightSlot, setParams]);

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

  // Assign a channel to the first empty slot (click-to-add from the dock).
  const pickChannel = useCallback((channel: CameraChannel) => {
    setTiles((prev) => {
      const idx = prev.findIndex((t) => t.channelId === null);
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

  // Derived counts for the toolbar indicator.
  const assignedCount = useMemo(() => tiles.filter((t) => t.channelId !== null).length, [tiles]);
  const liveCount = useMemo(() => {
    const pinned = tiles.filter((t) => t.pinned && t.channelId !== null).length;
    const budget = Math.max(0, MAX_LIVE_TILES - pinned);
    const nonPinnedAssigned = tiles.filter((t) => t.channelId !== null && !t.pinned).length;
    return pinned + Math.min(budget, nonPinnedAssigned);
  }, [tiles]);

  const empty = assignedCount === 0;

  return (
    <Stack
      sx={{
        height: '100%',
        // Neutralize the AppLayout content padding so the wall is full-bleed.
        margin: -3,
        backgroundColor: 'background.default',
      }}
    >
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

      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <ChannelDock channels={channels} onPick={pickChannel} onAutoFill={autoFill} />
        <Box ref={viewportRef} sx={{ flex: 1, minWidth: 0, minHeight: 0, p: 1 }}>
          {empty ? (
            <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', gap: 2 }}>
              <LayoutGrid size={48} color="#475569" />
              <Typography color="text.disabled">{t('video.empty')}</Typography>
              <Typography variant="caption" color="text.disabled">
                {t('video.emptyHelp')}
              </Typography>
            </Stack>
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
        </Box>
      </Box>
    </Stack>
  );
}
