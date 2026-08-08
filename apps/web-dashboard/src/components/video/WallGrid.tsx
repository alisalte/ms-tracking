/**
 * WallGrid — the viewport that lays out N tiles in a square grid.
 *
 * Implements the HikCentral-style division presets (1/4/9/16/36/64). The grid
 * is always square: `cols = rows = ceil(√division)`. For divisions that exceed
 * `maxLiveTiles` (36/64), only the live slots stream; the rest render as
 * placeholder "queued" tiles that the round-robin scheduler rotates in.
 *
 * Spotlight mode overlays a single enlarged tile with the rest as a thumbnail
 * strip (VideoPlatform §10.2.2) — useful for active monitoring on alert.
 */
import { useMemo } from 'react';

import { VideoTile } from '@/components/video/VideoTile';
import { useWallRotation } from '@/components/video/useWallRotation';
import type { CameraChannel, WallDivision, WallTile } from '@/types/video.types';
import { Box } from '@mui/material';

interface WallGridProps {
  /** The active grid division (1/4/9/16/36/64). */
  division: WallDivision;
  /** Tile assignments (slot → channel). Length must equal `division`. */
  tiles: WallTile[];
  /** Channel catalog (to resolve channel ids → CameraChannel objects). */
  channels: CameraChannel[];
  /** Slot currently spotlighted, or null. */
  spotlightSlot: number | null;
  /** Slot currently alerting (red border), or null. */
  alertSlot?: number | null;
  /** Toggle the round-robin scheduler (operator freeze). */
  rotationOn: boolean;
  /** Override the default live cap (cellular lowers this). */
  maxLive?: number;
  /** Assign a channel to the next free slot (click-to-promote from dock). */
  onTogglePin: (slot: number) => void;
  /** Remove the channel from a slot. */
  onRemove: (slot: number) => void;
}

/** Grid columns/rows for a division — always a perfect square. */
function gridSize(division: WallDivision): number {
  return Math.ceil(Math.sqrt(division));
}

export function WallGrid({
  division,
  tiles,
  channels,
  spotlightSlot,
  alertSlot = null,
  rotationOn,
  maxLive,
  onTogglePin,
  onRemove,
}: WallGridProps) {
  const live = useWallRotation(tiles, maxLive, rotationOn);
  const channelById = useMemo(() => {
    const m = new Map<string, CameraChannel>();
    for (const c of channels) m.set(c.id, c);
    return m;
  }, [channels]);

  const cols = gridSize(division);
  const inSpotlight = spotlightSlot !== null;

  // Spotlight layout: one big tile + a thumbnail column of the rest.
  if (inSpotlight) {
    const bigSlot = spotlightSlot;
    const thumbs = tiles.filter((t) => t.slot !== bigSlot);
    return (
      <Box sx={{ display: 'flex', height: '100%', width: '100%', gap: 0.5 }}>
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <TileForSlot
            tile={tiles.find((t) => t.slot === bigSlot) ?? tiles[0]}
            channelById={channelById}
            live={true}
            pinned={true}
            alert={alertSlot === bigSlot}
            onTogglePin={onTogglePin}
            onRemove={onRemove}
          />
        </Box>
        <Box
          sx={{
            width: 200,
            minWidth: 200,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.5,
            overflowY: 'auto',
          }}
        >
          {thumbs.map((t) => (
            <Box key={t.slot} sx={{ flex: '0 0 auto', aspectRatio: '16 / 9', width: '100%' }}>
              <TileForSlot
                tile={t}
                channelById={channelById}
                live={live.has(t.slot) || t.pinned}
                pinned={t.pinned}
                alert={alertSlot === t.slot}
                compact
                onTogglePin={onTogglePin}
                onRemove={onRemove}
              />
            </Box>
          ))}
        </Box>
      </Box>
    );
  }

  // Standard square grid.
  return (
    <Box
      data-testid="wall-grid"
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${cols}, 1fr)`,
        gap: 0.5,
        width: '100%',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
      }}
    >
      {tiles.map((t) => (
        <Box key={t.slot} sx={{ minWidth: 0, minHeight: 0 }}>
          <TileForSlot
            tile={t}
            channelById={channelById}
            live={live.has(t.slot) || t.pinned}
            pinned={t.pinned}
            alert={alertSlot === t.slot}
            onTogglePin={onTogglePin}
            onRemove={onRemove}
          />
        </Box>
      ))}
    </Box>
  );
}

/** Resolve a tile's channel and render the VideoTile for it. */
function TileForSlot({
  tile,
  channelById,
  live,
  pinned,
  alert,
  compact,
  onTogglePin,
  onRemove,
}: {
  tile: WallTile;
  channelById: Map<string, CameraChannel>;
  live: boolean;
  pinned: boolean;
  alert: boolean;
  compact?: boolean;
  onTogglePin: (slot: number) => void;
  onRemove: (slot: number) => void;
}) {
  const channel = tile.channelId ? (channelById.get(tile.channelId) ?? null) : null;
  return (
    <VideoTile
      channel={channel}
      live={live}
      pinned={pinned}
      alert={alert}
      compact={compact}
      onTogglePin={() => onTogglePin(tile.slot)}
      onRemove={() => onRemove(tile.slot)}
      onPromote={live ? undefined : () => onTogglePin(tile.slot)}
    />
  );
}
