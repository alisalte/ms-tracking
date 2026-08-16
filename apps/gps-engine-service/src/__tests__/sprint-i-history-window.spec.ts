/**
 * History window parsing tests (Sprint I §61 HISTORY 22–25).
 */
import { describe, expect, it } from '@jest/globals';
import { parseHistoryWindow } from '../application/history-window.js';

const NOW = new Date('2026-08-15T18:00:00Z');
const DAY = 86_400_000;

describe('parseHistoryWindow', () => {
  it('22. accepts a valid custom range (from < to, within max)', () => {
    const r = parseHistoryWindow({
      from: '2026-08-01T08:00:00Z',
      to: '2026-08-15T18:00:00Z',
      now: NOW,
    });
    expect(r.error).toBeUndefined();
    expect(r.window?.fromTime).toEqual(new Date('2026-08-01T08:00:00Z'));
    expect(r.window?.toTime).toEqual(new Date('2026-08-15T18:00:00Z'));
  });

  it('rejects preset AND from/to together (ambiguous — §30)', () => {
    const r = parseHistoryWindow({ preset: '24h', from: '2026-08-01T08:00:00Z', now: NOW });
    expect(r.error).toBe('AMBIGUOUS');
  });

  it('23. rejects from >= to', () => {
    const r = parseHistoryWindow({ from: '2026-08-15T18:00:00Z', to: '2026-08-01T08:00:00Z', now: NOW });
    expect(r.error).toBe('REVERSED');
    const same = parseHistoryWindow({ from: '2026-08-15T18:00:00Z', to: '2026-08-15T18:00:00Z', now: NOW });
    expect(same.error).toBe('REVERSED');
  });

  it('24. rejects a range larger than the maximum (default 31 days)', () => {
    const r = parseHistoryWindow({
      from: new Date(NOW.getTime() - 32 * DAY).toISOString(),
      to: NOW.toISOString(),
      now: NOW,
    });
    expect(r.error).toBe('RANGE_TOO_LARGE');
    // exactly 31 days is allowed
    const edge = parseHistoryWindow({
      from: new Date(NOW.getTime() - 31 * DAY).toISOString(),
      to: NOW.toISOString(),
      now: NOW,
    });
    expect(edge.error).toBeUndefined();
  });

  it('25. rejects invalid ISO timestamps', () => {
    const r = parseHistoryWindow({ from: 'not-a-date', to: NOW.toISOString(), now: NOW });
    expect(r.error).toBe('INVALID_ISO');
  });

  it('respects a custom (smaller) max range bound', () => {
    const r = parseHistoryWindow({
      from: new Date(NOW.getTime() - 8 * DAY).toISOString(),
      to: NOW.toISOString(),
      now: NOW,
      maxRangeDays: 7,
    });
    expect(r.error).toBe('RANGE_TOO_LARGE');
  });

  it('presets resolve to windows ending at now (server-side §30)', () => {
    const r = parseHistoryWindow({ preset: '6h', now: NOW });
    expect(r.error).toBeUndefined();
    expect(r.window?.toTime).toEqual(NOW);
    expect(r.window?.fromTime.getTime()).toBe(NOW.getTime() - 6 * 3_600_000);
  });

  it('unknown presets are rejected', () => {
    expect(parseHistoryWindow({ preset: '1y', now: NOW }).error).toBe('UNKNOWN_PRESET');
  });

  it('defaults to the last 24h when nothing is given', () => {
    const r = parseHistoryWindow({ now: NOW });
    expect(r.error).toBeUndefined();
    expect(r.window?.fromTime.getTime()).toBe(NOW.getTime() - DAY);
  });
});
