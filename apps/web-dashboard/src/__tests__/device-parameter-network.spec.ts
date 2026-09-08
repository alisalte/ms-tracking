import { beforeEach, describe, expect, it } from 'vitest';

import {
  composeNetworkCommands,
  defaultNetworkSett,
  loadCachedNetworkSett,
  mergeDb4ReplyIntoNetworkSett,
  mergeHistoryIntoNetworkSett,
  saveCachedNetworkSett,
  validateNetworkSett,
} from '@/lib/device-parameter-network';

describe('composeNetworkCommands', () => {
  it('emits A21 then intervals; A23 only when backup set', () => {
    const sett = defaultNetworkSett();
    sett.host = '10.0.0.1';
    sett.port = '6180';
    sett.apn = 'mcinet';
    const cmds = composeNetworkCommands(sett);
    expect(cmds.map((c) => c.commandCode)).toEqual(['A21', 'A11', 'A12', 'A15']);
    expect(cmds[0]?.params).toMatchObject({
      mode: '1',
      host: '10.0.0.1',
      port: 6180,
      apn: 'mcinet',
    });

    sett.backupHost = '10.0.0.2';
    sett.backupPort = '6181';
    expect(composeNetworkCommands(sett).map((c) => c.commandCode)).toEqual([
      'A21',
      'A23',
      'A11',
      'A12',
      'A15',
    ]);
  });
});

describe('network readback merge', () => {
  it('fills fields from a DB4 dump', () => {
    const dump =
      'DB4,TCP,IP1:178.131.31.231,PORT1:6180,IP2:10.0.0.2,PORT2:6181,420,mcinet,2,10,0,6,6,300,80,30,0,114';
    const { sett, changed } = mergeDb4ReplyIntoNetworkSett(defaultNetworkSett(), dump);
    expect(changed).toBe(true);
    expect(sett.mode).toBe('1');
    expect(sett.host).toBe('178.131.31.231');
    expect(sett.port).toBe('6180');
    expect(sett.backupHost).toBe('10.0.0.2');
    expect(sett.apn).toBe('mcinet');
    expect(sett.heartbeatMinutes).toBe(10);
    expect(sett.trackingInterval).toBe(6);
  });

  it('merges last SET params from history when ACK is OK-only', () => {
    const { sett, changed } = mergeHistoryIntoNetworkSett(defaultNetworkSett(), [
      {
        commandCode: 'A21',
        status: 'ACKED',
        params: { mode: '1', host: '1.2.3.4', port: 7000, apn: 'apn1' },
        responseText: 'A21,OK',
      },
    ]);
    expect(changed).toBe(true);
    expect(sett.host).toBe('1.2.3.4');
    expect(sett.port).toBe('7000');
  });
});

describe('network validation + cache', () => {
  beforeEach(() => localStorage.clear());

  it('requires host and a valid port', () => {
    const sett = defaultNetworkSett();
    expect(validateNetworkSett(sett)).toBe('host');
    sett.host = 'x';
    sett.port = '0';
    expect(validateNetworkSett(sett)).toBe('port');
    sett.port = '6180';
    expect(validateNetworkSett(sett)).toBeNull();
  });

  it('round-trips snapshot', () => {
    const sett = defaultNetworkSett();
    sett.host = 'edge.example';
    saveCachedNetworkSett('d1', sett, 'readback');
    expect(loadCachedNetworkSett('d1').host).toBe('edge.example');
  });
});
