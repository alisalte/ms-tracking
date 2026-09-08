import { beforeEach, describe, expect, it } from 'vitest';

import {
  composeAlertsCommands,
  defaultAlertsSett,
  loadCachedAlertsSett,
  mergeDb4ReplyIntoAlertsSett,
  mergeHistoryIntoAlertsSett,
  saveCachedAlertsSett,
  validateAlertsSett,
} from '@/lib/device-parameter-alerts';

describe('composeAlertsCommands', () => {
  it('emits B07, B10, D79, C03', () => {
    const sett = defaultAlertsSett();
    sett.speedKmh = 80;
    sett.towingSeconds = 5;
    sett.towingIdleMinutes = 3;
    sett.harshAcceleration = 200;
    sett.harshBraking = -200;
    sett.gprsEventMode = '1';
    expect(composeAlertsCommands(sett).map((c) => c.commandCode)).toEqual([
      'B07',
      'B10',
      'D79',
      'C03',
    ]);
    expect(composeAlertsCommands(sett)[0]?.params).toEqual({ speed: 80 });
    expect(composeAlertsCommands(sett)[1]?.params).toEqual({ seconds: 5, idleMinutes: 3 });
    expect(composeAlertsCommands(sett)[2]?.params).toEqual({
      acceleration: 200,
      braking: -200,
    });
  });
});

describe('alerts readback merge', () => {
  it('fills speeding from DB4 overspeed field', () => {
    const dump =
      'DB4,TCP,IP1:178.131.31.231,PORT1:6180,IP2:,PORT2:,420,mcinet,2,10,0,6,6,300,80,30,0,114';
    const base = defaultAlertsSett();
    base.speedKmh = 0;
    const { sett, changed } = mergeDb4ReplyIntoAlertsSett(base, dump);
    expect(changed).toBe(true);
    expect(sett.speedKmh).toBe(80);
  });

  it('merges B10/D79/C03 from history SET params', () => {
    const { sett, changed } = mergeHistoryIntoAlertsSett(defaultAlertsSett(), [
      {
        commandCode: 'B10',
        status: 'ACKED',
        params: { seconds: 7, idleMinutes: 4 },
        responseText: 'B10,OK',
      },
      {
        commandCode: 'D79',
        status: 'ACKED',
        params: { acceleration: 180, braking: -220 },
        responseText: 'D79,OK',
      },
      {
        commandCode: 'C03',
        status: 'ACKED',
        params: { mode: '1' },
        responseText: 'C03,OK',
      },
    ]);
    expect(changed).toBe(true);
    expect(sett.towingSeconds).toBe(7);
    expect(sett.towingIdleMinutes).toBe(4);
    expect(sett.harshAcceleration).toBe(180);
    expect(sett.harshBraking).toBe(-220);
    expect(sett.gprsEventMode).toBe('1');
  });
});

describe('alerts validation + cache', () => {
  beforeEach(() => localStorage.clear());

  it('rejects braking outside −1500…−100', () => {
    const sett = defaultAlertsSett();
    sett.harshBraking = -50;
    expect(validateAlertsSett(sett)).toBe('harshBraking');
    sett.harshBraking = -180;
    expect(validateAlertsSett(sett)).toBeNull();
  });

  it('round-trips snapshot', () => {
    const sett = defaultAlertsSett();
    sett.speedKmh = 90;
    saveCachedAlertsSett('d1', sett, 'history');
    expect(loadCachedAlertsSett('d1').speedKmh).toBe(90);
  });
});
