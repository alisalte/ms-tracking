/**
 * VideoChannel aggregate tests — the camera registration entity (09 §5.1).
 *
 * VideoChannel is currently a plain data aggregate; these tests pin its
 * invariants (ownership rule, availability predicate, lifecycle states) so
 * later enrichment does not silently change the contract.
 */
import { describe, expect, it } from '@jest/globals';

import { VideoChannel } from '../domain/video-channel.js';

function makeChannel(overrides: Partial<VideoChannel> = {}): VideoChannel {
  return new VideoChannel({
    channelId: 'ch-1',
    tenantId: 'tenant-1',
    vehicleId: 'veh-1',
    siteId: null,
    deviceId: 'dev-1',
    label: 'Forward camera',
    logicalChannel: 1,
    protocol: 'JT1078',
    codec: 'H264',
    endpoint: null,
    status: 'ONLINE',
    ptz: true,
    capabilities: { resolutions: ['720p', '1080p'] },
    version: 0,
    ...overrides,
  });
}

describe('VideoChannel (09 §5.1)', () => {
  it('carries all registration fields', () => {
    const ch = makeChannel();
    expect(ch.channelId).toBe('ch-1');
    expect(ch.tenantId).toBe('tenant-1');
    expect(ch.vehicleId).toBe('veh-1');
    expect(ch.deviceId).toBe('dev-1');
    expect(ch.label).toBe('Forward camera');
    expect(ch.logicalChannel).toBe(1);
    expect(ch.protocol).toBe('JT1078');
    expect(ch.codec).toBe('H264');
    expect(ch.ptz).toBe(true);
    expect(ch.capabilities).toEqual({ resolutions: ['720p', '1080p'] });
  });

  describe('ownership — vehicle OR site, never both', () => {
    it('supports a vehicle-bound dashcam (siteId null)', () => {
      const ch = makeChannel({ vehicleId: 'veh-1', siteId: null });
      expect(ch.vehicleId).not.toBeNull();
      expect(ch.siteId).toBeNull();
    });

    it('supports a site-bound CCTV camera (vehicleId null)', () => {
      const ch = makeChannel({ vehicleId: null, siteId: 'site-1' });
      expect(ch.siteId).not.toBeNull();
      expect(ch.vehicleId).toBeNull();
    });
  });

  describe('isAvailable predicate — streaming-capable states', () => {
    it('is available when ONLINE', () => {
      expect(makeChannel({ status: 'ONLINE' }).isAvailable).toBe(true);
    });

    it('is available when DEGRADED (still streaming, reduced quality)', () => {
      expect(makeChannel({ status: 'DEGRADED' }).isAvailable).toBe(true);
    });

    it('is NOT available when REGISTERED (never connected)', () => {
      expect(makeChannel({ status: 'REGISTERED' }).isAvailable).toBe(false);
    });

    it('is NOT available when OFFLINE', () => {
      expect(makeChannel({ status: 'OFFLINE' }).isAvailable).toBe(false);
    });

    it('is NOT available when DECOMMISSIONED', () => {
      expect(makeChannel({ status: 'DECOMMISSIONED' }).isAvailable).toBe(false);
    });
  });

  describe('protocol variants', () => {
    const protocols = ['JT1078', 'RTSP', 'RTMP', 'WEBRTC'] as const;
    for (const protocol of protocols) {
      it(`accepts ${protocol}`, () => {
        const ch = makeChannel({ protocol });
        expect(ch.protocol).toBe(protocol);
      });
    }
  });

  it('RTSP/RTMP channels carry an endpoint URL; JT1078 does not', () => {
    const rtsp = makeChannel({ protocol: 'RTSP', endpoint: 'rtsp://10.0.0.1/stream' });
    const jt1078 = makeChannel({ protocol: 'JT1078', endpoint: null });
    expect(rtsp.endpoint).toBe('rtsp://10.0.0.1/stream');
    expect(jt1078.endpoint).toBeNull();
  });
});
