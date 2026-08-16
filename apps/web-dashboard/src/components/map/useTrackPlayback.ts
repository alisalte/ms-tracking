/**
 * useTrackPlayback — requestAnimationFrame track playback engine
 * (Sprint I §32–§35).
 *
 * Time-based playback over a bounded, pre-loaded track dataset (never a
 * per-point fetch): the cursor advances through TRACK time at
 * BASE_TIME_SCALE × speed (1× = 60 track-seconds per real second); the sample
 * is interpolated between the two bracketing points.
 *
 * GAP-AWARE (§33): a temporal gap larger than `gapMs` (Sprint F's documented
 * 10-minute threshold) is NEVER interpolated across — the cursor snaps to the
 * next point, so the marker teleports exactly like the real vehicle did.
 *
 * PERFORMANCE (§35): the rAF loop mutates only refs; React state is emitted at
 * most every EMIT_INTERVAL_MS (100 ms) — no map recreation, no full-page
 * renders, no per-tick allocations beyond one small sample object.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { TrackPoint } from '@/api/map.api';

export const PLAYBACK_SPEEDS = [1, 2, 4, 8] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];
/** 1× speed compresses 60 track-seconds into one real second. */
export const BASE_TIME_SCALE = 60;
/** Temporal gap threshold (ms) — mirrors Sprint F's client-side gap split. */
export const GAP_THRESHOLD_MS = 10 * 60_000;

export interface PlaybackSample {
  readonly lat: number;
  readonly lng: number;
  readonly heading: number | null;
  readonly speedKph: number | null;
  readonly timestamp: string;
  readonly index: number;
  readonly inGap: boolean;
}

export interface UseTrackPlaybackResult {
  readonly isPlaying: boolean;
  readonly speed: PlaybackSpeed;
  readonly cursorMs: number;
  readonly startMs: number | null;
  readonly endMs: number | null;
  readonly sample: PlaybackSample | null;
  readonly play: () => void;
  readonly pause: () => void;
  readonly stop: () => void;
  readonly next: () => void;
  readonly prev: () => void;
  readonly seek: (ms: number) => void;
  readonly setSpeed: (s: PlaybackSpeed) => void;
}

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const p = Math.PI / 180;
  const y = Math.sin((lng2 - lng1) * p) * Math.cos(lat2 * p);
  const x =
    Math.cos(lat1 * p) * Math.sin(lat2 * p) -
    Math.sin(lat1 * p) * Math.cos(lat2 * p) * Math.cos((lng2 - lng1) * p);
  return (Math.atan2(y, x) / p + 360) % 360;
}

function parseMs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NaN : ms;
}

/** Interpolate the sample at `cursorMs` (snap when inside a gap). */
export function sampleTrackAt(
  points: readonly TrackPoint[],
  cursorMs: number,
  gapMs = GAP_THRESHOLD_MS,
): PlaybackSample | null {
  if (points.length === 0) return null;
  const first = points[0] as TrackPoint;
  const last = points[points.length - 1] as TrackPoint;
  const startMs = parseMs(first.capturedAt);
  const endMs = parseMs(last.capturedAt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return {
      lat: first.latitude,
      lng: first.longitude,
      heading: null,
      speedKph: first.speedKph ?? null,
      timestamp: first.capturedAt,
      index: 0,
      inGap: false,
    };
  }
  if (cursorMs <= startMs) {
    return {
      lat: first.latitude,
      lng: first.longitude,
      heading: null,
      speedKph: first.speedKph ?? null,
      timestamp: first.capturedAt,
      index: 0,
      inGap: false,
    };
  }
  if (cursorMs >= endMs) {
    return {
      lat: last.latitude,
      lng: last.longitude,
      heading: null,
      speedKph: last.speedKph ?? null,
      timestamp: last.capturedAt,
      index: points.length - 1,
      inGap: false,
    };
  }
  // Binary search for the bracketing pair.
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const midMs = parseMs((points[mid] as TrackPoint).capturedAt);
    if (Number.isNaN(midMs)) break;
    if (midMs <= cursorMs) lo = mid;
    else hi = mid;
  }
  const a = points[lo] as TrackPoint;
  const b = points[hi] as TrackPoint;
  const aMs = parseMs(a.capturedAt);
  const bMs = parseMs(b.capturedAt);
  if (Number.isNaN(aMs) || Number.isNaN(bMs) || bMs - aMs > gapMs) {
    // Inside a documented large gap — snap to the EARLIER point (§33: never
    // visually interpolate across the gap as if the vehicle drove through).
    return {
      lat: a.latitude,
      lng: a.longitude,
      heading: null,
      speedKph: a.speedKph ?? null,
      timestamp: a.capturedAt,
      index: lo,
      inGap: true,
    };
  }
  const t = bMs === aMs ? 0 : (cursorMs - aMs) / (bMs - aMs);
  return {
    lat: a.latitude + (b.latitude - a.latitude) * t,
    lng: a.longitude + (b.longitude - a.longitude) * t,
    heading: bearingDeg(a.latitude, a.longitude, b.latitude, b.longitude),
    speedKph: a.speedKph ?? null,
    timestamp: new Date(cursorMs).toISOString(),
    index: t < 0.5 ? lo : hi,
    inGap: false,
  };
}

export function useTrackPlayback(
  points: readonly TrackPoint[],
  opts: { onEnded?: () => void } = {},
): UseTrackPlaybackResult {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [cursorMs, setCursorMs] = useState<number>(0);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const lastEmitRef = useRef<number>(0);
  const cursorRef = useRef<number>(0);
  const playingRef = useRef(false);
  const speedRef = useRef<PlaybackSpeed>(1);
  const pointsRef = useRef<readonly TrackPoint[]>(points);
  const onEndedRef = useRef(opts.onEnded);
  pointsRef.current = points;
  onEndedRef.current = opts.onEnded;
  playingRef.current = isPlaying;
  speedRef.current = speed;

  const bounds = useMemo(() => {
    if (points.length === 0) return { startMs: null, endMs: null };
    const startMs = parseMs((points[0] as TrackPoint).capturedAt);
    const endMs = parseMs((points[points.length - 1] as TrackPoint).capturedAt);
    return {
      startMs: Number.isNaN(startMs) ? null : startMs,
      endMs: Number.isNaN(endMs) ? null : endMs,
    };
  }, [points]);

  // Reset the cursor when the dataset changes (new vehicle/window).
  useEffect(() => {
    cursorRef.current = bounds.startMs ?? 0;
    setCursorMs(bounds.startMs ?? 0);
    setIsPlaying(false);
  }, [bounds.startMs]);

  // The rAF loop — refs only; state emitted at ~10 Hz.
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastFrameRef.current = null;
      return;
    }
    const frame = (now: number) => {
      rafRef.current = requestAnimationFrame(frame);
      const pts = pointsRef.current;
      if (pts.length === 0) return;
      const last = pts[pts.length - 1] as TrackPoint;
      const endMs = parseMs(last.capturedAt);
      if (Number.isNaN(endMs)) return;
      const lastFrame = lastFrameRef.current ?? now;
      lastFrameRef.current = now;
      const dt = Math.min(250, now - lastFrame); // tab-switch guard
      let next = cursorRef.current + dt * BASE_TIME_SCALE * speedRef.current;
      // Gap jump: if the cursor would sweep a >gapMs hole, snap past it.
      const sampleIdx = sampleTrackAt(pts, cursorRef.current)?.index ?? 0;
      const nextSampleIdx = sampleTrackAt(pts, next)?.index ?? sampleIdx;
      if (nextSampleIdx > sampleIdx + 1) {
        // Swept across ≥2 indices — find the gap boundary and snap to the
        // start of the segment AFTER the gap.
        const nb = pts[nextSampleIdx] as TrackPoint;
        const nbMs = parseMs(nb.capturedAt);
        if (!Number.isNaN(nbMs)) next = nbMs;
      }
      if (next >= endMs) {
        cursorRef.current = endMs;
        setCursorMs(endMs);
        setIsPlaying(false);
        onEndedRef.current?.();
        return;
      }
      cursorRef.current = next;
      if (now - lastEmitRef.current >= 100) {
        lastEmitRef.current = now;
        setCursorMs(next);
      }
    };
    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastFrameRef.current = null;
    };
  }, [isPlaying]);

  const play = useCallback(() => {
    const pts = pointsRef.current;
    if (pts.length === 0) return;
    const last = pts[pts.length - 1] as TrackPoint;
    const endMs = parseMs(last.capturedAt);
    // Replay from the start when at (or past) the end.
    if (!Number.isNaN(endMs) && cursorRef.current >= endMs) {
      const startMs = parseMs((pts[0] as TrackPoint).capturedAt);
      cursorRef.current = Number.isNaN(startMs) ? 0 : startMs;
      setCursorMs(cursorRef.current);
    }
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => setIsPlaying(false), []);

  const stop = useCallback(() => {
    setIsPlaying(false);
    const pts = pointsRef.current;
    const first = pts[0] as TrackPoint | undefined;
    const startMs = first ? parseMs(first.capturedAt) : 0;
    cursorRef.current = Number.isNaN(startMs) ? 0 : startMs;
    setCursorMs(cursorRef.current);
  }, []);

  const step = useCallback((delta: 1 | -1) => {
    const pts = pointsRef.current;
    if (pts.length === 0) return;
    const current = sampleTrackAt(pts, cursorRef.current)?.index ?? 0;
    const target = Math.max(0, Math.min(pts.length - 1, current + delta));
    const targetMs = parseMs((pts[target] as TrackPoint).capturedAt);
    if (Number.isNaN(targetMs)) return;
    cursorRef.current = targetMs;
    setCursorMs(targetMs);
  }, []);

  const seek = useCallback((ms: number) => {
    cursorRef.current = ms;
    setCursorMs(ms);
  }, []);

  const sample = useMemo(() => sampleTrackAt(points, cursorMs), [points, cursorMs]);

  return {
    isPlaying,
    speed,
    cursorMs,
    startMs: bounds.startMs,
    endMs: bounds.endMs,
    sample,
    play,
    pause,
    stop,
    next: () => step(1),
    prev: () => step(-1),
    seek,
    setSpeed,
  };
}
