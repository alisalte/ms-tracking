import { describe, expect, it } from '@jest/globals';
import { type BreakPolicy, classifyStop, plannedOverlap } from '../domain/planned-stops.js';

/** Two 12 h shifts from 06:00, lunch 12:00–13:30, ±30 min handover, in UTC. */
const policy: BreakPolicy = {
  shiftStartMin: 6 * 60,
  shiftDurationMin: 12 * 60,
  shiftCount: 2,
  lunchStartMin: 12 * 60,
  lunchEndMin: 13 * 60 + 30,
  handoverWindowMin: 30,
  timeZone: 'UTC',
};
const at = (iso: string) => new Date(iso);

describe('planned stops', () => {
  it('a stop inside the lunch window is lunch, with or without the engine', () => {
    expect(
      classifyStop(at('2026-06-01T12:10:00Z'), at('2026-06-01T13:00:00Z'), false, policy),
    ).toBe('LUNCH');
    expect(classifyStop(at('2026-06-01T12:10:00Z'), at('2026-06-01T13:00:00Z'), true, policy)).toBe(
      'LUNCH',
    );
  });

  it('a long stop that only touches the lunch window stays operational', () => {
    expect(classifyStop(at('2026-06-01T10:00:00Z'), at('2026-06-01T15:00:00Z'), true, policy)).toBe(
      'OPERATIONAL',
    );
  });

  it('an engine-off stop at a shift boundary is the handover', () => {
    // 05:50–06:25 around the start of shift 1.
    expect(classifyStop(at('2026-06-01T05:50:00Z'), at('2026-06-01T06:25:00Z'), true, policy)).toBe(
      'HANDOVER',
    );
    // The boundary between shift 1 and 2 at 18:00 and the end of shift 2 at 06:00 next day.
    expect(classifyStop(at('2026-06-01T17:45:00Z'), at('2026-06-01T18:20:00Z'), true, policy)).toBe(
      'HANDOVER',
    );
    expect(classifyStop(at('2026-06-02T05:40:00Z'), at('2026-06-02T06:10:00Z'), true, policy)).toBe(
      'HANDOVER',
    );
  });

  it('a stop at a boundary with the engine running is not a handover', () => {
    expect(
      classifyStop(at('2026-06-01T05:50:00Z'), at('2026-06-01T06:25:00Z'), false, policy),
    ).toBe('OPERATIONAL');
  });

  it('an engine-off stop away from every boundary is operational', () => {
    expect(classifyStop(at('2026-06-01T09:00:00Z'), at('2026-06-01T09:40:00Z'), true, policy)).toBe(
      'OPERATIONAL',
    );
  });

  it('turning the handover window to 0 or having no policy leaves stops operational', () => {
    const off = { ...policy, handoverWindowMin: 0 };
    expect(classifyStop(at('2026-06-01T05:50:00Z'), at('2026-06-01T06:25:00Z'), true, off)).toBe(
      'OPERATIONAL',
    );
    expect(classifyStop(at('2026-06-01T12:10:00Z'), at('2026-06-01T13:00:00Z'), true, null)).toBe(
      'OPERATIONAL',
    );
  });

  it('a lunch window that crosses midnight works for a night shift', () => {
    const night = { ...policy, lunchStartMin: 23 * 60 + 30, lunchEndMin: 30 };
    expect(classifyStop(at('2026-06-01T23:40:00Z'), at('2026-06-02T00:20:00Z'), false, night)).toBe(
      'LUNCH',
    );
  });

  it('follows the local clock of the route, not UTC', () => {
    const tehran = { ...policy, timeZone: 'Asia/Tehran' }; // UTC+3:30
    // 12:10–13:00 Tehran = 08:40–09:30 UTC.
    expect(
      classifyStop(at('2026-06-01T08:40:00Z'), at('2026-06-01T09:30:00Z'), false, tehran),
    ).toBe('LUNCH');
    expect(
      classifyStop(at('2026-06-01T12:10:00Z'), at('2026-06-01T13:00:00Z'), false, tehran),
    ).toBe('OPERATIONAL');
  });

  it('counts overlapping lunch and handover minutes once', () => {
    // Lunch 05:45–06:15 over the 06:00 boundary: the shared minutes are lunch.
    const both = { ...policy, lunchStartMin: 5 * 60 + 45, lunchEndMin: 6 * 60 + 15 };
    const overlap = plannedOverlap(
      at('2026-06-01T05:45:00Z'),
      at('2026-06-01T06:15:00Z'),
      true,
      both,
    );
    expect(overlap.lunchSec + overlap.handoverSec).toBe(30 * 60);
    expect(overlap.lunchSec).toBe(30 * 60);
  });
});
