import { beforeEach, describe, expect, it } from 'vitest';

import {
  composeTrackingCommands,
  defaultTrackingSett,
  loadCachedTrackingSett,
  mergeDb4ReplyIntoTrackingSett,
  mergeHistoryIntoTrackingSett,
  saveCachedTrackingSett,
  validateTrackingSett,
} from '@/lib/device-parameter-tracking';

describe('composeTrackingCommands', () => {
  it('emits A13, A14, A16 in order', () => {
    const sett = defaultTrackingSett();
    sett.cornerAngle = 45;
    sett.distanceMeters = 500;
    sett.parkingTrackingEnabled = '0';
    expect(composeTrackingCommands(sett)).toEqual([
      { commandCode: 'A13', params: { angle: 45 }, label: 'A13 cornering' },
      { commandCode: 'A14', params: { distance: 500 }, label: 'A14 distance' },
      { commandCode: 'A16', params: { status: '0' }, label: 'A16 parking tracking' },
    ]);
  });
});

describe('tracking readback merge', () => {
  it('fills angle/distance from a DB4 dump', () => {
    const dump =
      'DB4,TCP,IP1:178.131.31.231,PORT1:6180,IP2:,PORT2:,420,mcinet,2,10,0,6,6,300,80,30,0,114';
    const base = defaultTrackingSett();
    base.cornerAngle = 0;
    base.distanceMeters = 0;
    const { sett, changed } = mergeDb4ReplyIntoTrackingSett(base, dump);
    expect(changed).toBe(true);
    expect(sett.distanceMeters).toBe(300);
    expect(sett.cornerAngle).toBe(30);
  });

  it('merges A16 from history SET params', () => {
    const { sett, changed } = mergeHistoryIntoTrackingSett(defaultTrackingSett(), [
      {
        commandCode: 'A16',
        status: 'ACKED',
        params: { status: '0' },
        responseText: 'A16,OK',
      },
    ]);
    expect(changed).toBe(true);
    expect(sett.parkingTrackingEnabled).toBe('0');
  });
});

describe('tracking validation + cache', () => {
  beforeEach(() => localStorage.clear());

  it('rejects out-of-range angle', () => {
    const sett = defaultTrackingSett();
    sett.cornerAngle = 400;
    expect(validateTrackingSett(sett)).toBe('cornerAngle');
    sett.cornerAngle = 30;
    expect(validateTrackingSett(sett)).toBeNull();
  });

  it('round-trips snapshot', () => {
    const sett = defaultTrackingSett();
    sett.distanceMeters = 250;
    saveCachedTrackingSett('d1', sett, 'readback');
    expect(loadCachedTrackingSett('d1').distanceMeters).toBe(250);
  });
});
