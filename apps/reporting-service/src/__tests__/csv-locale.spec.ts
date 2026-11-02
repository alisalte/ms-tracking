import { describe, expect, it } from '@jest/globals';
import {
  localizeAlarmType,
  localizeCsvHeader,
  localizeSeverity,
  localizeYesNo,
} from '../domain/csv-locale.js';

describe('localizeCsvHeader', () => {
  it('keeps machine keys for en', () => {
    expect(localizeCsvHeader(['vehicle', 'distance_km'])).toEqual(['vehicle', 'distance_km']);
  });

  it('maps to Persian titles for fa', () => {
    expect(localizeCsvHeader(['vehicle', 'start_date_shamsi', 'distance_km'], 'fa')).toEqual([
      'خودرو',
      'تاریخ شروع',
      'مسافت (کیلومتر)',
    ]);
  });

  it('passes unknown keys through', () => {
    expect(localizeCsvHeader(['new_column'], 'fa')).toEqual(['new_column']);
  });

  it('translates alarm codes, severities and yes/no for fa only', () => {
    expect(localizeAlarmType('overspeed', 'fa')).toBe('سرعت غیرمجاز');
    expect(localizeAlarmType('POWER_CUT', 'fa')).toBe('برق ردیاب قطع شد');
    expect(localizeAlarmType('custom_rule', 'fa')).toBe('custom_rule');
    expect(localizeAlarmType('overspeed')).toBe('overspeed');
    expect(localizeSeverity('CRITICAL', 'fa')).toBe('بحرانی');
    expect(localizeSeverity('HIGH')).toBe('HIGH');
    expect(localizeYesNo(true, 'fa')).toBe('بله');
    expect(localizeYesNo(false)).toBe('no');
  });
});
