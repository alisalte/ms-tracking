import { describe, expect, it } from '@jest/globals';
import { checkShifts, normalizeRoster } from '../application/haul-route.service.js';

describe('haul route shifts', () => {
  it('accepts two 12 h shifts and rejects shifts that overflow the day', () => {
    expect(checkShifts(6, 12, 2)).toEqual({
      startHour: 6,
      startMinute: 0,
      durationHours: 12,
      durationMinutes: 0,
      count: 2,
    });
    expect(() => checkShifts(6, 12, 3)).toThrow(/24 hours/);
    expect(() => checkShifts(24, 12, 1)).toThrow(/start hour/);
    expect(() => checkShifts(6, 0, 1)).toThrow(/length/);
    expect(() => checkShifts(6, 4, 5)).toThrow(/between 1 and 4/);
  });

  it('keeps the minutes of the start time and the shift length', () => {
    expect(checkShifts(6, 8, 2, 30, 15)).toEqual({
      startHour: 6,
      startMinute: 30,
      durationHours: 8,
      durationMinutes: 15,
      count: 2,
    });
    expect(() => checkShifts(6, 8, 3, 60)).toThrow(/start minute/);
    expect(() => checkShifts(6, 8, 3, 0, 61)).toThrow(/minutes/);
    expect(() => checkShifts(6, 8, 3, 0, 1)).toThrow(/24 hours/);
    expect(checkShifts(6, 0, 1, 0, 45).durationMinutes).toBe(45);
  });

  it('trims the roster to the shift count and drops trailing empty shifts', () => {
    expect(normalizeRoster(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
    expect(normalizeRoster([null, 'b'], 2)).toEqual([null, 'b']);
    expect(normalizeRoster(['a', null], 2)).toEqual(['a']);
    expect(normalizeRoster(undefined, 2)).toEqual([]);
  });
});
