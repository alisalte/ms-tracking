import { beforeEach, describe, expect, it } from 'vitest';

import {
  ALARM_PARAMETER_EVENTS,
  composeAlarmLinkSettCommands,
  defaultLinkSett,
  loadCachedLinkSett,
  loadSettMap,
  mergeB99AuthIntoSettMap,
  mergeCb8IntoSettMap,
  mergeHistoryIntoSettMap,
  parseB99AuthReply,
  parseCb8Reply,
  saveCachedLinkSett,
  sendableAlarmLinkCommands,
} from '@/lib/device-parameter-alarm';

describe('composeAlarmLinkSettCommands', () => {
  it('includes MDVR digital input events 2–16 (Input 1 Active absent; code 1 is SOS)', () => {
    const codes = ALARM_PARAMETER_EVENTS.map((e) => e.code);
    expect(codes).toContain(1);
    expect(codes).toContain(2);
    expect(codes).toContain(8);
    expect(codes).toContain(9);
    expect(codes).toContain(16);
    expect(ALARM_PARAMETER_EVENTS.find((e) => e.code === 16)?.labelKey).toBe('input8Inactive');
    expect(ALARM_PARAMETER_EVENTS.find((e) => e.code === 2)?.defaultAlarmHead).toBe('In2 Active');
    expect(ALARM_PARAMETER_EVENTS).toHaveLength(24);
  });

  it('emits B91 head and B99 GPRS for default transfer', () => {
    const overspeed = ALARM_PARAMETER_EVENTS.find((e) => e.code === 19)!;
    const sett = defaultLinkSett(overspeed);
    sett.transferGprs = true;
    const cmds = sendableAlarmLinkCommands(sett);
    expect(cmds.some((c) => c.commandCode === 'B91')).toBe(true);
    expect(cmds.some((c) => c.commandCode === 'B99' && c.params.target === '2')).toBe(true);
  });

  it('adds SMS/CALL B99 when phone flags set', () => {
    const ev = ALARM_PARAMETER_EVENTS[0]!;
    const sett = defaultLinkSett(ev);
    sett.phones[0] = { number: '+989121234567', sms: true, call: true };
    const cmds = sendableAlarmLinkCommands(sett);
    const sms = cmds.filter((c) => c.commandCode === 'B99' && c.params.target === '0');
    const call = cmds.filter((c) => c.commandCode === 'B99' && c.params.target === '1');
    expect(sms).toHaveLength(1);
    expect(call).toHaveLength(1);
    expect(sms[0]?.params.phone).toBe('+989121234567');
  });

  it('emits CB8 when a recording channel is checked', () => {
    const ev = ALARM_PARAMETER_EVENTS.find((e) => e.code === 19)!;
    const sett = defaultLinkSett(ev);
    sett.delayRecordingSec = 10;
    sett.channelRecording[0] = true;
    const cmds = sendableAlarmLinkCommands(sett);
    const cb8 = cmds.find((c) => c.commandCode === 'CB8');
    expect(cb8?.params.entries).toContain('19,1,10,1');
  });

  it('marks FTP/VOICE/high outputs as unsupported', () => {
    const sett = defaultLinkSett(ALARM_PARAMETER_EVENTS[0]!);
    sett.transferFtp = true;
    sett.transferVoice = true;
    sett.outputs[5] = true;
    const all = composeAlarmLinkSettCommands(sett);
    expect(all.some((c) => c.unsupported && c.commandCode === 'FTP')).toBe(true);
    expect(all.some((c) => c.unsupported && c.commandCode === 'VOICE')).toBe(true);
    expect(all.some((c) => c.unsupported && c.label.includes('Output 6'))).toBe(true);
  });
});

describe('Phase 1C readback parsers', () => {
  it('parses B99 GPRS GET reply event codes', () => {
    expect(parseB99AuthReply('B99,2,0,19,20,1')).toEqual({
      target: '2',
      phone: undefined,
      eventCodes: [19, 20, 1],
    });
  });

  it('parses B99 SMS GET reply with phone', () => {
    expect(parseB99AuthReply('B99,0,09121234567,0,18,19')).toEqual({
      target: '0',
      phone: '09121234567',
      eventCodes: [18, 19],
    });
  });

  it('parses CB8 entries after operation prefix', () => {
    expect(parseCb8Reply('CB8,1;19,1,10,1;20,2,5,1')).toEqual([
      { event: 19, channel: 1, seconds: 10, priority: 1 },
      { event: 20, channel: 2, seconds: 5, priority: 1 },
    ]);
  });

  it('merges GPRS auth and CB8 into sett map', () => {
    const map = new Map(
      ALARM_PARAMETER_EVENTS.map((ev) => {
        const sett = defaultLinkSett(ev);
        sett.transferGprs = false;
        return [ev.code, sett] as const;
      }),
    );
    mergeB99AuthIntoSettMap(map, { target: '2', eventCodes: [19, 1] });
    mergeCb8IntoSettMap(map, [{ event: 19, channel: 2, seconds: 12, priority: 1 }]);
    expect(map.get(19)?.transferGprs).toBe(true);
    expect(map.get(18)?.transferGprs).toBe(false);
    expect(map.get(1)?.transferGprs).toBe(true);
    expect(map.get(19)?.channelRecording[1]).toBe(true);
    expect(map.get(19)?.delayRecordingSec).toBe(12);
  });

  it('merges B91 headers from ACKED history params', () => {
    const map = new Map(
      ALARM_PARAMETER_EVENTS.map((ev) => [ev.code, defaultLinkSett(ev)] as const),
    );
    const changed = mergeHistoryIntoSettMap(map, [
      {
        commandCode: 'B91',
        status: 'ACKED',
        params: { eventCode: 19, header: 'Fast!' },
        responseText: 'B91,OK',
      },
    ]);
    expect(changed).toBe(true);
    expect(map.get(19)?.alarmHead).toBe('Fast!');
  });
});

describe('snapshot cache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips sett with source metadata', () => {
    const ev = ALARM_PARAMETER_EVENTS.find((e) => e.code === 19)!;
    const sett = defaultLinkSett(ev);
    sett.alarmHead = 'SpeedX';
    saveCachedLinkSett('dev-1', sett, 'readback');
    expect(loadCachedLinkSett('dev-1', ev).alarmHead).toBe('SpeedX');
    const map = loadSettMap('dev-1');
    expect(map.get(19)?.alarmHead).toBe('SpeedX');
  });
});
