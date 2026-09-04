import { describe, expect, it } from 'vitest';

import { lastStoredSettings, parseMeitrackReadback } from '@/lib/meitrack-readback';

describe('parseMeitrackReadback', () => {
  it('fills A21 server params from a device ACK', () => {
    expect(parseMeitrackReadback('A21', 'A21,1,178.131.31.231,6180,mcinet,,')).toEqual({
      mode: '1',
      host: '178.131.31.231',
      port: '6180',
      apn: 'mcinet',
      apnUser: '',
      apnPassword: '',
    });
  });

  it('fills A11 interval and ignores a bare OK', () => {
    expect(parseMeitrackReadback('A11', 'A11,10')).toEqual({ minutes: '10' });
    expect(parseMeitrackReadback('A11', 'A11,OK')).toEqual({});
  });

  it('fills A21/A11 from a DB4 device-parameter dump', () => {
    const dump =
      'DB4,TCP,IP1:178.131.31.231,PORT1:6180,IP2:,PORT2:,420,mcinet,2,10,0,6,6,300,80,30,0,114';
    expect(parseMeitrackReadback('A21', dump)).toMatchObject({
      mode: '1',
      host: '178.131.31.231',
      port: '6180',
      apn: 'mcinet',
    });
    expect(parseMeitrackReadback('A11', dump)).toEqual({ minutes: '10' });
    expect(parseMeitrackReadback('A12', dump)).toEqual({ interval: '6' });
  });

  it('prefers a DB4 dump over a later OK-only A21 ACK', () => {
    const history = [
      {
        commandCode: 'A21',
        status: 'ACKED',
        params: {},
        responseText: 'A21,OK',
      },
      {
        commandCode: 'DB4',
        status: 'ACKED',
        params: {},
        responseText:
          'DB4,TCP,IP1:178.131.31.231,PORT1:6180,IP2:,PORT2:,420,mcinet,2,10,0,6,6,300,80,30,0,114',
      },
    ];
    expect(lastStoredSettings('A21', history)?.host).toBe('178.131.31.231');
  });

  it('falls back to last SET params when the ACK is only OK', () => {
    expect(
      lastStoredSettings('A21', [
        {
          commandCode: 'A21',
          status: 'ACKED',
          params: { mode: '1', host: '10.0.0.1', port: 6180 },
          responseText: 'A21,OK',
        },
      ]),
    ).toMatchObject({ host: '10.0.0.1', port: '6180' });
  });
});
