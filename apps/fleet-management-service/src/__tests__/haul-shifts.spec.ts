import { describe, expect, it } from '@jest/globals';
import { checkShifts, normalizeRoster } from '../application/haul-route.service.js';

describe('haul route shifts', () => {
  it('accepts two 12 h shifts and rejects shifts that overflow the day', () => {
    expect(checkShifts(6, 12, 2)).toEqual({ startHour: 6, durationHours: 12, count: 2 });
    expect(() => checkShifts(6, 12, 3)).toThrow(/24 hours/);
    expect(() => checkShifts(24, 12, 1)).toThrow(/start hour/);
    expect(() => checkShifts(6, 0, 1)).toThrow(/length/);
    expect(() => checkShifts(6, 4, 5)).toThrow(/between 1 and 4/);
  });

  it('trims the roster to the shift count and drops trailing empty shifts', () => {
    expect(normalizeRoster(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
    expect(normalizeRoster([null, 'b'], 2)).toEqual([null, 'b']);
    expect(normalizeRoster(['a', null], 2)).toEqual(['a']);
    expect(normalizeRoster(undefined, 2)).toEqual([]);
  });
});
