/**
 * useTrackPlayback tests (Sprint I §61 PLAYBACK 30–34): play/pause stepping,
 * seek, speed, and gap-aware snapping — driven by a fake rAF clock.
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TrackPoint } from '@/api/map.api';
import {
  GAP_THRESHOLD_MS,
  sampleTrackAt,
  useTrackPlayback,
} from '@/components/map/useTrackPlayback';

function track(points: Array<[string, number, number]>): TrackPoint[] {
  return points.map(([capturedAt, latitude, longitude], i) => ({
    vehicleId: 'v1',
    latitude,
    longitude,
    speedKph: 40,
    headingDeg: 0,
    capturedAt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __i: i,
  })) as unknown as TrackPoint[];
}

describe('sampleTrackAt', () => {
  const pts = track([
    ['2026-08-01T10:00:00Z', 35.7, 51.4],
    ['2026-08-01T10:10:00Z', 35.8, 51.5],
  ]);

  it('interpolates between two bracketing points', () => {
    const s = sampleTrackAt(pts, Date.parse('2026-08-01T10:05:00Z'));
    expect(s).not.toBeNull();
    expect(s?.lat).toBeCloseTo(35.75, 5);
    expect(s?.lng).toBeCloseTo(51.45, 5);
    expect(s?.heading).not.toBeNull();
  });

  it('34. NEVER interpolates across a documented large gap (snaps to earlier point)', () => {
    const gapped = track([
      ['2026-08-01T10:00:00Z', 35.7, 51.4],
      ['2026-08-01T12:00:00Z', 35.9, 51.6], // 2h gap > 10 min
    ]);
    const s = sampleTrackAt(gapped, Date.parse('2026-08-01T11:00:00Z'));
    expect(s?.inGap).toBe(true);
    expect(s?.lat).toBeCloseTo(35.7, 6); // snapped to the pre-gap point
  });

  it('clamps before start / after end', () => {
    expect(sampleTrackAt(pts, Date.parse('2026-08-01T09:00:00Z'))?.lat).toBeCloseTo(35.7);
    expect(sampleTrackAt(pts, Date.parse('2026-08-01T11:00:00Z'))?.lat).toBeCloseTo(35.8);
  });
});

describe('useTrackPlayback', () => {
  let rafCallbacks: Array<{ id: number; cb: FrameRequestCallback }>;
  let rafSeq: number;
  let now: number;

  beforeEach(() => {
    rafCallbacks = [];
    rafSeq = 0;
    now = 1_000_000;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = ++rafSeq;
      rafCallbacks.push({ id, cb });
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks = rafCallbacks.filter((c) => c.id !== id);
    });
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function tick(frames = 1, dtMs = 100): void {
    act(() => {
      for (let f = 0; f < frames; f++) {
        now += dtMs;
        const cbs = rafCallbacks;
        rafCallbacks = [];
        for (const { cb } of cbs) cb(now);
      }
    });
  }

  const pts = track([
    ['2026-08-01T10:00:00Z', 35.7, 51.4],
    ['2026-08-01T10:10:00Z', 35.8, 51.5],
    ['2026-08-01T10:20:00Z', 35.9, 51.6],
  ]);

  it('30/31. play advances the cursor; pause stops it', () => {
    const { result } = renderHook(() => useTrackPlayback(pts));
    act(() => result.current.play());
    tick(5, 100); // 0.5 real s → 30 track s at 1× (60× compression)
    const advanced = result.current.cursorMs;
    expect(advanced).toBeGreaterThan(Date.parse('2026-08-01T10:00:00Z'));
    act(() => result.current.pause());
    tick(5, 100);
    expect(result.current.cursorMs).toBe(advanced); // frozen while paused
  });

  it('32. seek moves the cursor to an arbitrary track time', () => {
    const { result } = renderHook(() => useTrackPlayback(pts));
    const target = Date.parse('2026-08-01T10:12:30Z');
    act(() => result.current.seek(target));
    expect(result.current.cursorMs).toBe(target);
    expect(result.current.sample?.lat).toBeCloseTo(35.825, 3);
  });

  it('33. speed multiplies the advance rate (2× doubles the step)', () => {
    const { result } = renderHook(() => useTrackPlayback(pts));
    act(() => {
      result.current.play();
      result.current.setSpeed(2);
    });
    tick(2, 100); // frame 1 warms up (dt 0); frame 2: 0.1 s × 60 × 2 = 12 s
    expect(result.current.cursorMs).toBe(Date.parse('2026-08-01T10:00:12Z'));
  });

  it('34. a large gap is jumped over, not swept through', () => {
    const gapped = track([
      ['2026-08-01T10:00:00Z', 35.7, 51.4],
      ['2026-08-01T12:00:00Z', 35.9, 51.6],
    ]);
    const { result } = renderHook(() => useTrackPlayback(gapped));
    act(() => result.current.play());
    // 60 frames × 100 ms (frame 1 warms up) → 59 × 0.1 s × 60 = 354 track s.
    tick(60, 100); // ~5.9 track minutes — still before the 2-hour gap
    expect(result.current.cursorMs).toBe(Date.parse('2026-08-01T10:05:54Z'));
    tick(100, 100); // sweep past the gap → cursor snaps to 12:00 (or beyond → end)
    expect(
      result.current.cursorMs >= Date.parse('2026-08-01T12:00:00Z') ||
        result.current.sample?.inGap === true,
    ).toBe(true);
    // The marker NEVER sits mid-gap interpolated:
    if (result.current.cursorMs < Date.parse('2026-08-01T12:00:00Z')) {
      expect(result.current.sample?.inGap).toBe(true);
      expect(result.current.sample?.lat).toBeCloseTo(35.7);
    }
  });

  it('stop resets to the start and stops playing', () => {
    const { result } = renderHook(() => useTrackPlayback(pts));
    act(() => {
      result.current.play();
    });
    tick(5, 100);
    act(() => result.current.stop());
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.cursorMs).toBe(Date.parse('2026-08-01T10:00:00Z'));
  });

  it('reaching the end pauses and reports the final sample', () => {
    const { result } = renderHook(() => useTrackPlayback(pts));
    act(() => result.current.play());
    tick(10_000, 100); // way past the end
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.cursorMs).toBe(Date.parse('2026-08-01T10:20:00Z'));
    expect(result.current.sample?.lat).toBeCloseTo(35.9);
  });
});

void GAP_THRESHOLD_MS;
