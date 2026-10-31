/**
 * Speeding-event evidence report — pure grouping logic.
 *
 * Every number here is computed from GPS fixes the device really reported
 * (`tracking.vehicle_positions.speed_kmh`). Nothing is estimated or filled in:
 * a window with no fix above the limit yields NO episode. The report is meant
 * to back up (or refute) a dashboard figure such as "90 km/h", so it keeps the
 * raw fixes of each episode next to the aggregates.
 */

import { haversineMeters } from './haul-cycles.js';

/** One reported GPS fix. */
export interface SpeedFix {
  readonly at: Date;
  readonly lat: number;
  readonly lng: number;
  readonly speedKmh: number;
}

/** A run of consecutive fixes above the limit. */
export interface SpeedingEpisode {
  readonly startedAt: Date;
  readonly endedAt: Date;
  /** Seconds between the first and last over-limit fix (0 for a single fix). */
  readonly durationSec: number;
  readonly fixCount: number;
  readonly maxSpeedKmh: number;
  readonly avgSpeedKmh: number;
  /** How far above the limit the fastest fix was. */
  readonly overLimitKmh: number;
  readonly start: { readonly lat: number; readonly lng: number };
  readonly end: { readonly lat: number; readonly lng: number };
  /** Where the fastest fix was reported. */
  readonly peak: { readonly at: Date; readonly lat: number; readonly lng: number };
  /** Every over-limit fix of the episode, oldest first (the evidence). */
  readonly fixes: readonly SpeedFix[];
}

/** Two over-limit fixes further apart than this are two separate episodes. */
export const EPISODE_GAP_SEC = 120;

/** Faster than this is a GPS spike, not a speed (same cap the alarm engine uses). */
export const MAX_PLAUSIBLE_KMH = 300;

/**
 * Plausibility screen. Calibrated on 30 days of fleet telemetry (Oct 2026):
 * reported speed vs the speed the track itself shows has a median ratio of
 * ~1.03 (p75 ~1.15); speed changes between fixes stay under ~12 km/h/s (p99).
 */
/** Rising faster than this into a fix (km/h per second, ~0.42 g) is not a vehicle. */
export const MAX_ACCEL_KMH_PER_SEC = 15;
/** Dropping faster than this out of a fix (km/h per second, ~0.85 g) is not a vehicle. */
export const MAX_DECEL_KMH_PER_SEC = 30;
/** Neighbours further away than this say nothing about a fix. */
export const NEIGHBOUR_MAX_GAP_SEC = 30;
/** Half-width of the window the track speed is measured over. */
export const TRACK_WINDOW_SEC = 30;
/** Fewer track segments than this in the window: the track cannot judge. */
export const TRACK_MIN_SEGMENTS = 3;
/** Reported speed this many times the track speed is contradicted by the track. */
export const TRACK_MAX_RATIO = 1.3;

/** Why an over-limit fix was set aside instead of counted. */
export type DiscardReason = 'ACCEL' | 'DECEL' | 'TRACK';

export interface DiscardedFix extends SpeedFix {
  readonly reason: DiscardReason;
  /** Speed the positions show around the fix (median, km/h); null when too few. */
  readonly trackKmh: number | null;
}

/**
 * Split over-limit fixes into the ones the surrounding telemetry backs up and
 * GPS errors. `context` holds the VALID fixes around them (any speed). A fix is
 * discarded when reaching it or leaving it would take an impossible speed
 * change, or when the positions around it show the vehicle under the limit and
 * far slower than reported. With no usable context a fix is kept.
 */
export function screenSpeedFixes(
  fixes: readonly SpeedFix[],
  context: readonly SpeedFix[],
  options: { readonly limitKmh: number },
): { kept: SpeedFix[]; discarded: DiscardedFix[] } {
  const byTime = new Map<number, SpeedFix>();
  for (const f of context) if (!byTime.has(f.at.getTime())) byTime.set(f.at.getTime(), f);
  for (const f of fixes) byTime.set(f.at.getTime(), f);
  const track = [...byTime.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
  const index = new Map(track.map((f, i) => [f.at.getTime(), i]));

  const kept: SpeedFix[] = [];
  const discarded: DiscardedFix[] = [];
  for (const fix of fixes) {
    const i = index.get(fix.at.getTime()) as number;
    const trackKmh = trackSpeedAround(track, i);
    const reason = speedChangeReason(track, i) ?? trackReason(fix, trackKmh, options.limitKmh);
    if (reason) discarded.push({ ...fix, reason, trackKmh });
    else kept.push(fix);
  }
  return { kept, discarded };
}

function speedChangeReason(track: readonly SpeedFix[], i: number): DiscardReason | null {
  const fix = track[i] as SpeedFix;
  const prev = track[i - 1];
  const next = track[i + 1];
  const t = fix.at.getTime();
  if (prev) {
    const dt = (t - prev.at.getTime()) / 1000;
    if (
      dt <= NEIGHBOUR_MAX_GAP_SEC &&
      (fix.speedKmh - prev.speedKmh) / dt > MAX_ACCEL_KMH_PER_SEC
    ) {
      return 'ACCEL';
    }
  }
  if (next) {
    const dt = (next.at.getTime() - t) / 1000;
    if (
      dt <= NEIGHBOUR_MAX_GAP_SEC &&
      (fix.speedKmh - next.speedKmh) / dt > MAX_DECEL_KMH_PER_SEC
    ) {
      return 'DECEL';
    }
  }
  return null;
}

function trackReason(
  fix: SpeedFix,
  trackKmh: number | null,
  limitKmh: number,
): DiscardReason | null {
  if (trackKmh === null) return null;
  return trackKmh <= limitKmh && fix.speedKmh > trackKmh * TRACK_MAX_RATIO ? 'TRACK' : null;
}

/** Median of the position-derived segment speeds within ±TRACK_WINDOW_SEC of fix i. */
function trackSpeedAround(track: readonly SpeedFix[], i: number): number | null {
  const t = (track[i] as SpeedFix).at.getTime();
  const span = TRACK_WINDOW_SEC * 1000;
  let lo = i;
  while (lo > 0 && t - (track[lo - 1] as SpeedFix).at.getTime() <= span) lo--;
  let hi = i;
  while (hi < track.length - 1 && (track[hi + 1] as SpeedFix).at.getTime() - t <= span) hi++;
  const speeds: number[] = [];
  for (let k = lo; k < hi; k++) {
    const a = track[k] as SpeedFix;
    const b = track[k + 1] as SpeedFix;
    const dt = (b.at.getTime() - a.at.getTime()) / 1000;
    speeds.push((haversineMeters(a.lat, a.lng, b.lat, b.lng) / dt) * 3.6);
  }
  if (speeds.length < TRACK_MIN_SEGMENTS) return null;
  speeds.sort((x, y) => x - y);
  const mid = speeds.length >> 1;
  const median =
    speeds.length % 2
      ? (speeds[mid] as number)
      : ((speeds[mid - 1] as number) + (speeds[mid] as number)) / 2;
  return Math.round(median * 10) / 10;
}

export interface GroupOptions {
  readonly limitKmh: number;
  readonly gapSec?: number;
}

/**
 * Group fixes (any order) into speeding episodes. Fixes at or below the limit,
 * or implausibly fast, are ignored. A gap of more than `gapSec` between two
 * over-limit fixes starts a new episode.
 */
export function groupSpeedingEpisodes(
  fixes: readonly SpeedFix[],
  options: GroupOptions,
): SpeedingEpisode[] {
  const gapMs = (options.gapSec ?? EPISODE_GAP_SEC) * 1000;
  const over = fixes
    .filter(
      (f) =>
        Number.isFinite(f.speedKmh) &&
        f.speedKmh > options.limitKmh &&
        f.speedKmh <= MAX_PLAUSIBLE_KMH,
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const runs: SpeedFix[][] = [];
  for (const fix of over) {
    const run = runs[runs.length - 1];
    const last = run?.[run.length - 1];
    if (run && last && fix.at.getTime() - last.at.getTime() <= gapMs) run.push(fix);
    else runs.push([fix]);
  }
  return runs.map((run) => toEpisode(run, options.limitKmh));
}

function toEpisode(run: readonly SpeedFix[], limitKmh: number): SpeedingEpisode {
  const first = run[0] as SpeedFix;
  const last = run[run.length - 1] as SpeedFix;
  let peak = first;
  let sum = 0;
  for (const fix of run) {
    sum += fix.speedKmh;
    if (fix.speedKmh > peak.speedKmh) peak = fix;
  }
  return {
    startedAt: first.at,
    endedAt: last.at,
    durationSec: Math.round((last.at.getTime() - first.at.getTime()) / 1000),
    fixCount: run.length,
    maxSpeedKmh: peak.speedKmh,
    avgSpeedKmh: Math.round((sum / run.length) * 10) / 10,
    overLimitKmh: Math.round((peak.speedKmh - limitKmh) * 10) / 10,
    start: { lat: first.lat, lng: first.lng },
    end: { lat: last.lat, lng: last.lng },
    peak: { at: peak.at, lat: peak.lat, lng: peak.lng },
    fixes: run,
  };
}
