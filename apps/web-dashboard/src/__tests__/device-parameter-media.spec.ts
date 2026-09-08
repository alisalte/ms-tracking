import { beforeEach, describe, expect, it } from 'vitest';

import {
  composeMediaCommands,
  defaultMediaSett,
  loadCachedMediaSett,
  mergeHistoryIntoMediaSett,
  mergeReplyIntoMediaSett,
  saveCachedMediaSett,
  validateMediaSett,
} from '@/lib/device-parameter-media';

describe('composeMediaCommands', () => {
  it('emits BB8 then B64; clear mode skips FTP fields', () => {
    const sett = defaultMediaSett();
    sett.speakerVolume = 40;
    sett.ftpMode = '1';
    sett.ftpHost = 'ftp.example';
    sett.ftpPort = '21';
    sett.ftpUsername = 'u';
    sett.ftpPassword = 'p';
    sett.ftpPath = '/photos';
    const cmds = composeMediaCommands(sett);
    expect(cmds.map((c) => c.commandCode)).toEqual(['BB8', 'B64']);
    expect(cmds[0]?.params).toEqual({ volume: 40 });
    expect(cmds[1]?.params).toMatchObject({
      mode: '1',
      host: 'ftp.example',
      path: '/photos',
    });

    sett.ftpMode = '2';
    expect(composeMediaCommands(sett).map((c) => c.commandCode)).toEqual(['BB8', 'B64']);
    expect(composeMediaCommands(sett)[1]?.params).toEqual({ mode: '2' });
  });
});

describe('media readback merge', () => {
  it('fills volume from BB8 reply', () => {
    const { sett, changed } = mergeReplyIntoMediaSett(defaultMediaSett(), 'BB8', 'BB8,55');
    expect(changed).toBe(true);
    expect(sett.speakerVolume).toBe(55);
  });

  it('fills FTP from B64 reply and history SET params', () => {
    const fromReply = mergeReplyIntoMediaSett(
      defaultMediaSett(),
      'B64',
      'B64,1,user,pass,ftp.example,21,/cam',
    );
    expect(fromReply.sett.ftpHost).toBe('ftp.example');
    expect(fromReply.sett.ftpMode).toBe('1');

    const { sett, changed } = mergeHistoryIntoMediaSett(defaultMediaSett(), [
      {
        commandCode: 'BB8',
        status: 'ACKED',
        params: { volume: 12 },
        responseText: 'BB8,OK',
      },
    ]);
    expect(changed).toBe(true);
    expect(sett.speakerVolume).toBe(12);
  });
});

describe('media validation + cache', () => {
  beforeEach(() => localStorage.clear());

  it('requires host/port when FTP upload is on', () => {
    const sett = defaultMediaSett();
    sett.ftpMode = '1';
    expect(validateMediaSett(sett)).toBe('ftpHost');
    sett.ftpHost = 'x';
    sett.ftpPort = '0';
    expect(validateMediaSett(sett)).toBe('ftpPort');
    sett.ftpPort = '21';
    expect(validateMediaSett(sett)).toBeNull();
  });

  it('round-trips snapshot', () => {
    const sett = defaultMediaSett();
    sett.speakerVolume = 77;
    saveCachedMediaSett('d1', sett, 'readback');
    expect(loadCachedMediaSett('d1').speakerVolume).toBe(77);
  });
});
