/**
 * useWallRotation — the wall's bandwidth cap + round-robin scheduler.
 *
 * For 36/64 layouts the wall can't keep every tile live (a browser can't
 * sustain 64 simultaneous streams). This hook decides *which* tile slots are
 * "live" at any moment within `maxLiveTiles`, and rotates the rest on a
 * `WALL_ROTATION_MS` cadence so every channel gets airtime (VideoPlatform
 * §10.2.1 — "a scheduler rotates non-active tiles round-robin 30s to bound
 * bandwidth").
 *
 * Rules:
 * - Pinned tiles are always live (spotlighted content stays).
 * - The remaining live budget is filled from assigned, non-pinned slots.
 * - On each tick, the live set advances: the oldest non-pinned live slot is
 *   retired and the next assigned-but-not-yet-live slot is promoted.
 * - Slots with no channel assigned are skipped.
 */
import { useEffect, useState } from 'react';

import { MAX_LIVE_TILES, WALL_ROTATION_MS } from '@/types/video.types';
import type { WallTile } from '@/types/video.types';

/**
 * @param tiles        The wall's current tile assignments.
 * @param maxLive      Override the default cap (e.g. lower on cellular).
 * @param rotationOn   Toggle the scheduler (operator can freeze rotation).
 * @returns Set of slot numbers that are currently live.
 */
export function useWallRotation(
  tiles: WallTile[],
  maxLive = MAX_LIVE_TILES,
  rotationOn = true,
): Set<number> {
  const [live, setLive] = useState<Set<number>>(new Set());

  // Recompute the live set whenever the tiles or cap change.
  useEffect(() => {
    setLive(computeLiveSet(tiles, maxLive));
  }, [tiles, maxLive]);

  // Advance the round-robin on the configured cadence.
  useEffect(() => {
    if (!rotationOn) return;

    // If we're within budget, nothing to rotate.
    const assigned = tiles.filter((t) => t.channelId !== null);
    if (assigned.length <= maxLive) return;

    const id = setInterval(() => {
      setLive((prev) => advanceRotation(tiles, prev, maxLive));
    }, WALL_ROTATION_MS);
    return () => clearInterval(id);
  }, [tiles, maxLive, rotationOn]);

  return live;
}

/** Pick the initial live set: pinned first, then fill from assigned slots. */
function computeLiveSet(tiles: WallTile[], maxLive: number): Set<number> {
  const result = new Set<number>();
  // Pinned slots are always live (outside the budget for content, but counted).
  for (const t of tiles) {
    if (t.pinned && t.channelId !== null) result.add(t.slot);
  }
  // Fill the remaining budget from assigned, non-pinned slots in order.
  for (const t of tiles) {
    if (result.size >= maxLive) break;
    if (t.channelId !== null && !t.pinned) result.add(t.slot);
  }
  return result;
}

/**
 * One round-robin step: retire the first non-pinned live slot, promote the
 * next assigned-but-idle slot. Pinned slots are never retired.
 */
function advanceRotation(tiles: WallTile[], current: Set<number>, maxLive: number): Set<number> {
  const next = new Set(current);

  // Find the first non-pinned live slot to retire.
  const liveNonPinned = tiles.find((t) => next.has(t.slot) && !t.pinned && t.channelId !== null);
  if (liveNonPinned) next.delete(liveNonPinned.slot);

  // Find the next assigned, not-currently-live slot to promote.
  const candidate = tiles.find((t) => t.channelId !== null && !next.has(t.slot));
  if (candidate) next.add(candidate.slot);

  // Guard against exceeding the cap (can happen with many pinned tiles).
  while (next.size > maxLive) {
    const drop = tiles.find((t) => next.has(t.slot) && !t.pinned);
    if (!drop) break;
    next.delete(drop.slot);
  }
  return next;
}
