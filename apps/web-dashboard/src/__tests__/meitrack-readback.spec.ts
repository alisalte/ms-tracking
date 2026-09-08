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

  it('fills BB8 volume and B64 FTP from device ACK', () => {
    expect(parseMeitrackReadback('BB8', 'BB8,42')).toEqual({ volume: '42' });
    expect(parseMeitrackReadback('B64', 'B64,1,u,p,ftp.example,21,/cam')).toEqual({
      mode: '1',
      username: 'u',
      password: 'p',
      host: 'ftp.example',
      port: '21',
      path: '/cam',
    });
  });

  it('fills C90 DMS volume and toggles from device ACK', () => {
    expect(parseMeitrackReadback('C90', 'C90,2,1,0,1,0')).toEqual({
      volume: '2',
      absence: '1',
      distraction: '0',
      smoking: '1',
      phoneCall: '0',
    });
  });
});
