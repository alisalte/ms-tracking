/**
 * Which shift of the work day an instant falls in, and which of a vehicle's
 * shift drivers was on duty. The schedule is the haul route's: shift 1 starts
 * at `startHour` local time and the shifts run back to back.
 */

export interface ShiftSchedule {
  readonly startHour: number;
  readonly durationHours: number;
  readonly shiftCount: number;
  readonly timeZone: string;
}

/** 1-based shift number at `at`, or null when the instant is after the last shift. */
export function shiftNoAt(at: Date, schedule: ShiftSchedule): number | null {
  const start = Math.min(23, Math.max(0, Math.floor(schedule.startHour)));
  const duration = Math.min(24, Math.max(1, Math.floor(schedule.durationHours)));
  const count = Math.min(Math.floor(24 / duration), Math.max(1, Math.floor(schedule.shiftCount)));
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: schedule.timeZone,
      hourCycle: 'h23',
      hour: '2-digit',
    }).format(at),
  );
  const no = Math.floor(((hour - start + 24) % 24) / duration) + 1;
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
