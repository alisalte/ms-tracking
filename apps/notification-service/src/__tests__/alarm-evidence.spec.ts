import { describe, expect, it } from '@jest/globals';
import {
  computeEvidenceExpiry,
  computeVideoWindow,
  extractCabinChannel,
  extractPhotoName,
  isDmsOrAdasAlarmCode,
  toMdvrBcdUtc,
} from '../domain/alarm-evidence.js';

describe('alarm-evidence domain', () => {
  it('detects DMS/ADAS codes', () => {
    expect(isDmsOrAdasAlarmCode('DMS_PHONE_CALL')).toBe(true);
    expect(isDmsOrAdasAlarmCode('ADAS_FCW')).toBe(true);
    expect(isDmsOrAdasAlarmCode('SOS')).toBe(false);
  });

  it('extracts photoName and cabin channel', () => {
    expect(extractPhotoName({ photoName: 'a.jpg' })).toBe('a.jpg');
    expect(extractCabinChannel('240823120009_CH2_E126S8_0.jpg')).toBe(2);
    expect(extractCabinChannel(null)).toBe(2);
  });

  it('computes 5+10 video window, BCD, and 30d expiry', () => {
    const t = new Date('2026-09-09T12:00:00.000Z');
    const w = computeVideoWindow(t);
    expect(w.from.toISOString()).toBe('2026-09-09T11:59:55.000Z');
    expect(w.to.toISOString()).toBe('2026-09-09T12:00:10.000Z');
    expect(toMdvrBcdUtc(w.from)).toBe('260909115955');
    expect(computeEvidenceExpiry(t).toISOString()).toBe('2026-10-09T12:00:00.000Z');
  });
});
