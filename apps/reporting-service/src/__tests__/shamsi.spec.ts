import { describe, expect, it } from '@jest/globals';
import { shamsiCells, shamsiStamp } from '../domain/shamsi.js';

describe('shamsi export stamps', () => {
  it('writes the Tehran-local Shamsi date and clock with Latin digits', () => {
    // 6 Sep 2026 10:30:15 UTC = 14:00:15 in Tehran (UTC+3:30) = 15 Shahrivar 1405.
    expect(shamsiStamp(new Date('2026-09-06T10:30:15Z'), 'Asia/Tehran')).toEqual({
      date: '1405/06/15',
      time: '14:00:15',
    });
  });

  it('moves to the next Shamsi day after local midnight', () => {
    expect(shamsiStamp(new Date('2026-09-06T21:00:00Z'), 'Asia/Tehran')).toEqual({
      date: '1405/06/16',
      time: '00:30:00',
    });
  });

  it('accepts ISO strings and leaves empty cells for missing values', () => {
    expect(shamsiCells('2026-09-06T10:30:15Z', 'Asia/Tehran')).toEqual(['1405/06/15', '14:00:15']);
    expect(shamsiCells(null, 'Asia/Tehran')).toEqual(['', '']);
    expect(shamsiCells('not a date', 'Asia/Tehran')).toEqual(['', '']);
  });
});
