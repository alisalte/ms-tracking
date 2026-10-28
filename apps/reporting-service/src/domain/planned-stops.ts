/**
 * Planned stops: the lunch break and the shift handover.
 *
 * A machine that stands still at lunch, or that is switched off while one
 * driver hands the shift over to the next, has not lost the fleet any time of
 * its own. Those stops are told apart from the stops of the machine by the
 * clock, using the schedule of its haul route:
 *
 *   lunch      the lunch window (local time, may cross midnight)
 *   handover   engine off, within `handoverWindowMin` of a shift boundary
 *              (start of shift 1, start of shift 2, ... end of the last shift)
 *
 * A stop belongs to a category when most of it (at least half) lies inside
 * that category's window; otherwise it is an ordinary stop.
 */

export type StopCategory = 'OPERATIONAL' | 'LUNCH' | 'HANDOVER';

export interface BreakPolicy {
  /** Start of shift 1 as minutes past local midnight. */
  readonly shiftStartMin: number;
  readonly shiftDurationMin: number;
  readonly shiftCount: number;
  /** Lunch window as minutes past local midnight; null = no lunch break. */
  readonly lunchStartMin: number | null;
  readonly lunchEndMin: number | null;
  /** Minutes either side of a shift boundary; 0 = no handover detection. */
  readonly handoverWindowMin: number;
  readonly timeZone: string;
}

export interface PlannedOverlap {
  readonly lunchSec: number;
  readonly handoverSec: number;
}

/** Share of a stop that has to lie in a window for the stop to belong to it. */
export const PLANNED_SHARE = 0.5;

const MIN_MS = 60_000;
const DAY_MIN = 1440;
const DAY_MS = 86_400_000;

const NONE: PlannedOverlap = { lunchSec: 0, handoverSec: 0 };

/** Milliseconds a zone is ahead of UTC at `at` (Iran has no daylight saving; others are handled). */
function offsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const n = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  const local = Date.UTC(
    n('year'),
    n('month') - 1,
    n('day'),
    n('hour') % 24,
    n('minute'),
    n('second'),
  );
  return local - Math.floor(at.getTime() / 1000) * 1000;
}

/** Length of the overlap of two closed-open ranges, in ms. */
function overlapMs(aFrom: number, aTo: number, bFrom: number, bTo: number): number {
  return Math.max(0, Math.min(aTo, bTo) - Math.max(aFrom, bFrom));
}

/**
 * Seconds of [from, to) that fall in the lunch window and in a handover
 * window of `policy`. `engineOff` gates the handover: a machine that keeps
 * its engine on at the boundary is not handing over.
 */
export function plannedOverlap(
  from: Date,
  to: Date,
  engineOff: boolean,
  policy: BreakPolicy | null,
): PlannedOverlap {
  if (!policy || to.getTime() <= from.getTime()) return NONE;
  const shift = offsetMs(from, policy.timeZone);
  const a = from.getTime() + shift;
  const b = to.getTime() + shift;
  const firstDay = Math.floor(a / DAY_MS) - 1;
  const lastDay = Math.floor(b / DAY_MS);

  let lunchMs = 0;
  if (policy.lunchStartMin !== null && policy.lunchEndMin !== null) {
    const length = (policy.lunchEndMin - policy.lunchStartMin + DAY_MIN) % DAY_MIN || DAY_MIN;
    for (let day = firstDay; day <= lastDay; day += 1) {
      const start = day * DAY_MS + policy.lunchStartMin * MIN_MS;
      lunchMs += overlapMs(a, b, start, start + length * MIN_MS);
    }
  }

  let handoverMs = 0;
  if (engineOff && policy.handoverWindowMin > 0) {
    const windowMs = policy.handoverWindowMin * MIN_MS;
    const spans: Array<[number, number]> = [];
    for (let day = firstDay; day <= lastDay; day += 1) {
      for (let k = 0; k <= policy.shiftCount; k += 1) {
        const boundary =
          day * DAY_MS + (policy.shiftStartMin + k * policy.shiftDurationMin) * MIN_MS;
        spans.push([boundary - windowMs, boundary + windowMs]);
      }
    }
    // Merge so touching windows (back-to-back shifts) are not counted twice.
    spans.sort((x, y) => x[0] - y[0]);
    let cursor: [number, number] | null = null;
    for (const span of spans) {
      if (cursor && span[0] <= cursor[1]) cursor[1] = Math.max(cursor[1], span[1]);
      else {
        if (cursor) handoverMs += overlapMs(a, b, cursor[0], cursor[1]);
        cursor = [span[0], span[1]];
      }
    }
    if (cursor) handoverMs += overlapMs(a, b, cursor[0], cursor[1]);
  }

  // Lunch wins where both windows cover the same minutes.
  const total = b - a;
  handoverMs = Math.min(handoverMs, Math.max(0, total - lunchMs));
  return { lunchSec: lunchMs / 1000, handoverSec: handoverMs / 1000 };
}

/** The category of a whole stop from the seconds of it inside each window. */
export function categoryOf(overlap: PlannedOverlap, durationSec: number): StopCategory {
  if (durationSec <= 0) return 'OPERATIONAL';
  if (overlap.lunchSec / durationSec >= PLANNED_SHARE) return 'LUNCH';
  if (overlap.handoverSec / durationSec >= PLANNED_SHARE) return 'HANDOVER';
  return 'OPERATIONAL';
}

/** Convenience: the category of the stop [from, to). */
export function classifyStop(
  from: Date,
  to: Date,
  engineOff: boolean,
  policy: BreakPolicy | null,
): StopCategory {
  return categoryOf(
    plannedOverlap(from, to, engineOff, policy),
    (to.getTime() - from.getTime()) / 1000,
  );
}

export interface RouteBreakRow {
  shift_start_hour: number;
  shift_start_minute: number | null;
  shift_duration_hours: number;
  shift_duration_minutes: number | null;
  shift_count: number;
  lunch_start_minute: number | null;
  lunch_end_minute: number | null;
  handover_window_minutes: number | null;
}

/** The policy of a haul route row. */
export function policyOfRoute(row: RouteBreakRow, timeZone: string): BreakPolicy {
  return {
    shiftStartMin: row.shift_start_hour * 60 + (row.shift_start_minute ?? 0),
    shiftDurationMin: Math.max(
      1,
      row.shift_duration_hours * 60 + (row.shift_duration_minutes ?? 0),
    ),
    shiftCount: Math.max(1, row.shift_count),
    lunchStartMin: row.lunch_start_minute,
    lunchEndMin: row.lunch_end_minute,
    handoverWindowMin: row.handover_window_minutes ?? 30,
    timeZone,
  };
}
