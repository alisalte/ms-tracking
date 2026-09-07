import { describe, expect, it } from 'vitest';

import { mdvrDevicesFromChannels, pickDmsChannel } from '@/lib/dms-channel';
import type { CameraChannel } from '@/types/video.types';

function ch(over: Partial<CameraChannel> & Pick<CameraChannel, 'id'>): CameraChannel {
  return {
    label: over.id,
    facing: 'site',
    sourceType: 'vehicle',
    sourceId: 'v1',
    sourceLabel: 'Pride',
    codec: 'H264',
    online: true,
    recordingActive: false,
    aiEnabled: false,
    cabinCam: false,
    consentGiven: true,
    protocol: 'MEITRACK_MDVR',
    deviceId: 'dev-1',
    imei: '867191086416152',
    logicalChannel: 1,
    ...over,
  };
}

describe('pickDmsChannel', () => {
  it('prefers an explicit driver / cabin camera', () => {
    const channels = [
      ch({ id: 'c1', logicalChannel: 1, facing: 'forward' }),
      ch({ id: 'c2', logicalChannel: 3, facing: 'driver', cabinCam: true }),
    ];
    expect(pickDmsChannel(channels, 'dev-1')?.id).toBe('c2');
  });

  it('falls back to logical channel 2 (MD300 DMS)', () => {
    const channels = [ch({ id: 'c1', logicalChannel: 1 }), ch({ id: 'c2', logicalChannel: 2 })];
    expect(pickDmsChannel(channels, 'dev-1')?.id).toBe('c2');
  });

  it('otherwise uses the first camera on that device', () => {
    const channels = [ch({ id: 'c1', logicalChannel: 1 })];
    expect(pickDmsChannel(channels, 'dev-1')?.id).toBe('c1');
  });

  it('ignores cameras on other devices', () => {
    const channels = [
      ch({ id: 'other', deviceId: 'dev-2', logicalChannel: 2, facing: 'driver' }),
      ch({ id: 'mine', logicalChannel: 1 }),
    ];
    expect(pickDmsChannel(channels, 'dev-1')?.id).toBe('mine');
  });
});

describe('mdvrDevicesFromChannels', () => {
  it('dedupes by deviceId', () => {
    const channels = [
      ch({ id: 'c1', logicalChannel: 1 }),
      ch({ id: 'c2', logicalChannel: 2 }),
      ch({ id: 'site', protocol: 'WEBRTC', deviceId: 'site-1', imei: undefined }),
    ];
    expect(mdvrDevicesFromChannels(channels)).toEqual([
      { deviceId: 'dev-1', label: 'Pride', imei: '867191086416152' },
    ]);
  });
});
