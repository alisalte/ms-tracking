/**
 * Speeding-event evidence report — pure grouping logic.
 *
 * Every number here is computed from GPS fixes the device really reported
 * (`tracking.vehicle_positions.speed_kmh`). Nothing is estimated or filled in:
 * a window with no fix above the limit yields NO episode. The report is meant
 * to back up (or refute) a dashboard figure such as "90 km/h", so it keeps the
 * raw fixes of each episode next to the aggregates.
 */

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
