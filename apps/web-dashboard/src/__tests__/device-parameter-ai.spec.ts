import { beforeEach, describe, expect, it } from 'vitest';

import {
  composeAiCommands,
  composeDmsCalibrationCommand,
  defaultAiSett,
  loadCachedAiSett,
  mergeHistoryIntoAiSett,
  mergeReplyIntoAiSett,
  saveCachedAiSett,
  validateAiSett,
} from '@/lib/device-parameter-ai';

describe('composeAiCommands', () => {
  it('emits a single C90 with volume and toggles', () => {
    const sett = defaultAiSett();
    sett.volume = '1';
    sett.smoking = '0';
    const cmds = composeAiCommands(sett);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({
      commandCode: 'C90',
      params: {
        volume: '1',
        absence: '1',
        distraction: '1',
        smoking: '0',
        phoneCall: '1',
      },
    });
  });

  it('composes CD1 calibration as a one-shot action', () => {
    expect(composeDmsCalibrationCommand()).toEqual({
      commandCode: 'CD1',
      params: { action: '1' },
      label: 'CD1 DMS calibration',
    });
  });
});

describe('ai readback merge', () => {
  it('fills from C90 reply text', () => {
    const { sett, changed } = mergeReplyIntoAiSett(defaultAiSett(), 'C90,0,1,0,1,0');
    expect(changed).toBe(true);
    expect(sett.volume).toBe('0');
    expect(sett.absence).toBe('1');
    expect(sett.distraction).toBe('0');
    expect(sett.smoking).toBe('1');
    expect(sett.phoneCall).toBe('0');
  });

  it('falls back to last SET params when ACK is OK-only', () => {
    const { sett, changed } = mergeHistoryIntoAiSett(defaultAiSett(), [
      {
        commandCode: 'C90',
        status: 'ACKED',
        params: { volume: '225', absence: '0', distraction: '1', smoking: '1', phoneCall: '1' },
        responseText: 'C90,OK',
      },
    ]);
    expect(changed).toBe(true);
    expect(sett.volume).toBe('225');
    expect(sett.absence).toBe('0');
  });
});

describe('ai validation + cache', () => {
  beforeEach(() => localStorage.clear());

  it('accepts default sett', () => {
    expect(validateAiSett(defaultAiSett())).toBeNull();
  });

  it('round-trips snapshot', () => {
    const sett = defaultAiSett();
    sett.volume = '0';
    saveCachedAiSett('d1', sett, 'readback');
    expect(loadCachedAiSett('d1').volume).toBe('0');
  });
});
