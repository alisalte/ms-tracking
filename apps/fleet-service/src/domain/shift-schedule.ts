/**
 * Which shift of the work day an instant falls in, and which of a vehicle's
 * shift drivers was on duty. The schedule is the haul route's: shift 1 starts
 * at `startHour` local time and the shifts run back to back.
 */

export interface ShiftSchedule {
  /** Fractional hours are allowed: 6.5 starts at 06:30. */
  readonly startHour: number;
  /** Fractional hours are allowed: 8.25 is 8 h 15 min. */
  readonly durationHours: number;
  readonly shiftCount: number;
  readonly timeZone: string;
}

/** 1-based shift number at `at`, or null when the instant is after the last shift. */
export function shiftNoAt(at: Date, schedule: ShiftSchedule): number | null {
  const start = Math.min(1439, Math.max(0, Math.round(schedule.startHour * 60)));
  const duration = Math.min(1440, Math.max(1, Math.round(schedule.durationHours * 60)));
  const count = Math.min(Math.floor(1440 / duration), Math.max(1, Math.floor(schedule.shiftCount)));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: schedule.timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const minuteOfDay = (part('hour') % 24) * 60 + part('minute');
  const no = Math.floor(((minuteOfDay - start + 1440) % 1440) / duration) + 1;
  return no > count ? null : no;
}

export interface ShiftAssignmentCandidate {
  readonly driverId: string;
  readonly shiftNo: number | null;
  readonly startedAt: Date;
}

/**
 * The driver to credit.
 *   shiftNo number      the driver of that shift, else the any-shift driver
 *   shiftNo null        off-shift: only an any-shift driver
 *   shiftNo undefined   no known schedule: the any-shift driver, else the latest assignment
 */
export function pickShiftDriver(
  candidates: readonly ShiftAssignmentCandidate[],
  shiftNo: number | null | undefined,
): string | null {
  const latest = (list: readonly ShiftAssignmentCandidate[]) =>
    [...list].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0]?.driverId ?? null;
  const anyShift = candidates.filter((c) => c.shiftNo == null);
  if (typeof shiftNo === 'number') {
    const exact = candidates.filter((c) => c.shiftNo === shiftNo);
    if (exact.length > 0) return latest(exact);
  }
  if (anyShift.length > 0) return latest(anyShift);
  return shiftNo === undefined ? latest(candidates) : null;
}
