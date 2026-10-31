import { describe, expect, it } from '@jest/globals';
import {
  type SpeedFix,
  groupSpeedingEpisodes,
  screenSpeedFixes,
} from '../domain/speeding-events.js';

const t0 = Date.parse('2026-10-30T08:00:00Z');
const fix = (sec: number, speedKmh: number): SpeedFix => ({
  at: new Date(t0 + sec * 1000),
  lat: 36 + sec / 10_000,
  lng: 52,
  speedKmh,
});

describe('groupSpeedingEpisodes', () => {
  it('returns nothing when no fix is above the limit (never invents an event)', () => {
    expect(groupSpeedingEpisodes([fix(0, 40), fix(10, 80), fix(20, 60)], { limitKmh: 80 })).toEqual(
      [],
    );
  });

  it('groups consecutive over-limit fixes and reports real aggregates', () => {
    const [e, ...rest] = groupSpeedingEpisodes(
      [fix(0, 70), fix(10, 85), fix(20, 90), fix(30, 88), fix(40, 60)],
      { limitKmh: 80 },
    );
    expect(rest).toHaveLength(0);
    expect(e?.fixCount).toBe(3);
    expect(e?.maxSpeedKmh).toBe(90);
    expect(e?.avgSpeedKmh).toBe(87.7);
    expect(e?.overLimitKmh).toBe(10);
    expect(e?.durationSec).toBe(20);
    expect(e?.peak.at.getTime()).toBe(t0 + 20_000);
  });

  it('splits episodes on a gap longer than the gap threshold', () => {
    const eps = groupSpeedingEpisodes([fix(0, 95), fix(10, 96), fix(500, 99)], { limitKmh: 80 });
    expect(eps.map((e) => e.fixCount)).toEqual([2, 1]);
  });

  it('drops implausible GPS spikes', () => {
    expect(groupSpeedingEpisodes([fix(0, 450)], { limitKmh: 80 })).toEqual([]);
  });

  it('sorts unordered input', () => {
    const [e] = groupSpeedingEpisodes([fix(20, 90), fix(0, 85), fix(10, 88)], { limitKmh: 80 });
    expect(e?.fixes.map((f) => f.speedKmh)).toEqual([85, 88, 90]);
  });
});

/**
 * A drive along a meridian: each [sec, reportedKmh, trackKmh] step moves the
 * vehicle at trackKmh since the previous step (1° latitude ≈ 111.2 km).
 */
function drive(steps: ReadonlyArray<readonly [number, number, number]>): SpeedFix[] {
  let lat = 33.92;
  let prevSec = steps[0]?.[0] ?? 0;
  return steps.map(([sec, reported, track]) => {
    lat += ((track / 3.6) * (sec - prevSec)) / 111_195;
    prevSec = sec;
    return { at: new Date(t0 + sec * 1000), lat, lng: 50.67, speedKmh: reported };
  });
}
const over = (fixes: SpeedFix[], limit = 80) => fixes.filter((f) => f.speedKmh > limit);

describe('screenSpeedFixes', () => {
  it('keeps a speeding run the track confirms', () => {
    const track = drive([
      [0, 70, 70],
      [5, 85, 85],
      [10, 92, 92],
      [15, 95, 95],
      [20, 88, 88],
      [25, 75, 75],
    ]);
    const r = screenSpeedFixes(over(track), track, { limitKmh: 80 });
    expect(r.kept.map((f) => f.speedKmh)).toEqual([85, 92, 95, 88]);
    expect(r.discarded).toEqual([]);
  });

  it('discards a jump from standstill no vehicle can make (0 → 144 in 9 s)', () => {
    const track = drive([
      [0, 0, 0],
      [9, 144, 91],
    ]);
    const r = screenSpeedFixes(over(track), track, { limitKmh: 80 });
    expect(r.kept).toEqual([]);
    expect(r.discarded[0]?.reason).toBe('ACCEL');
  });

  it('discards a lone peak that falls off faster than any brake (82 → 43 in 1 s)', () => {
    const track = drive([
      [0, 28, 30],
      [6, 71, 30],
      [8, 82, 30],
      [9, 43, 30],
      [17, 41, 30],
    ]);
    const r = screenSpeedFixes(over(track), track, { limitKmh: 80 });
    expect(r.discarded.map((f) => f.reason)).toEqual(['DECEL']);
  });

  it('discards speeds the positions contradict (reported ~85, track ~30)', () => {
    const track = drive([
      [0, 70, 30],
      [3, 81, 30],
      [6, 75, 30],
      [9, 90, 30],
      [12, 72, 30],
      [15, 83, 30],
      [18, 70, 30],
    ]);
    const r = screenSpeedFixes(over(track), track, { limitKmh: 80 });
    expect(r.kept).toEqual([]);
    expect(r.discarded.map((f) => f.reason)).toEqual(['TRACK', 'TRACK', 'TRACK']);
    expect(r.discarded[0]?.trackKmh).toBeCloseTo(30, 0);
  });

  it('keeps a fix whose track is near the reported speed even if a bit slower', () => {
    const track = drive([
      [0, 80, 76],
      [5, 84, 76],
      [10, 86, 76],
      [15, 82, 76],
    ]);
    expect(screenSpeedFixes(over(track), track, { limitKmh: 80 }).discarded).toEqual([]);
  });

  it('keeps a fix it cannot judge (no context around it)', () => {
    const lone = drive([[0, 95, 0]]);
    expect(screenSpeedFixes(lone, [], { limitKmh: 80 }).kept).toHaveLength(1);
  });

  it('ignores neighbours further away than the gap', () => {
    const track = drive([
      [0, 0, 0],
      [60, 100, 100],
    ]);
    expect(screenSpeedFixes(over(track), track, { limitKmh: 80 }).kept).toHaveLength(1);
  });
});
