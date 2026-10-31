import { describe, expect, it } from '@jest/globals';
import { type SpeedFix, groupSpeedingEpisodes } from '../domain/speeding-events.js';

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
