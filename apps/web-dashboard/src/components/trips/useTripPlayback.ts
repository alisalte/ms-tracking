import { useCallback, useEffect, useRef, useState } from 'react';

/** Allowed playback speeds (UI_UX_Design.md §3.7 transport pattern). */
export const PLAYBACK_SPEEDS = [1, 2, 4] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** Base tick interval (ms) between advancing one waypoint at 1×. */
const TICK_MS = 700;

interface TripPlayback {
  /** Current waypoint index. */
  index: number;
  isPlaying: boolean;
  speed: PlaybackSpeed;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Jump to a specific waypoint index (e.g. clicking a timeline marker). */
  seek: (i: number) => void;
  setSpeed: (s: PlaybackSpeed) => void;
}

/**
 * useTripPlayback — owns the replay transport state.
 *
 * Advances the waypoint index on a timer scaled by the selected speed; clamps
 * at the last waypoint and pauses. Reset (to index 0) happens when the caller
 * changes the `total` (i.e. a new trip loads).
 */
export function useTripPlayback(total: number): TripPlayback {
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset to the start whenever a new track (new total) arrives. The total is
  // read inside the effect so the dependency is genuinely used, not just a
  // trigger.
  useEffect(() => {
    if (total <= 0) return;
    setIndex(0);
    setIsPlaying(false);
  }, [total]);

  const stopTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Drive the advance while playing.
  useEffect(() => {
    stopTimer();
    if (!isPlaying) return;
    intervalRef.current = setInterval(() => {
      setIndex((prev) => {
        if (prev >= total - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, TICK_MS / speed);
    return stopTimer;
  }, [isPlaying, speed, total, stopTimer]);

  const play = useCallback(() => {
    // If at the end, restart from the beginning on play.
    setIndex((prev) => (prev >= total - 1 ? 0 : prev));
    if (total > 1) setIsPlaying(true);
  }, [total]);

  const pause = useCallback(() => setIsPlaying(false), []);
  const toggle = useCallback(() => (isPlaying ? pause() : play()), [isPlaying, pause, play]);
  const seek = useCallback((i: number) => setIndex(Math.max(0, Math.min(i, total - 1))), [total]);
  const changeSpeed = useCallback((s: PlaybackSpeed) => setSpeed(s), []);

  return { index, isPlaying, speed, play, pause, toggle, seek, setSpeed: changeSpeed };
}
