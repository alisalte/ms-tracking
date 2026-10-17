import { describe, expect, it } from 'vitest';

import {
  type CameraCatalogDevice,
  alignCameraCatalog,
  onlineCameraDeviceCount,
} from '@/lib/camera-presence';
import { MOTION_FRESH_MS } from '@/lib/vehicle-motion';
import type { CameraChannel } from '@/types/video.types';

const NOW = Date.parse('2026-10-17T12:00:00Z');

function channel(partial: Partial<CameraChannel> & Pick<CameraChannel, 'id'>): CameraChannel {
  return {
    label: 'Camera 1',
    facing: 'forward',
    sourceType: 'vehicle',
    sourceId: 'veh-1',
    sourceLabel: 'Truck 1',
    codec: 'H264',
    online: true,
    recordingActive: false,
    aiEnabled: false,
    cabinCam: false,
    consentGiven: true,
    protocol: 'MEITRACK_MDVR',
    logicalChannel: 1,
    ...partial,
  };
}

function device(
  partial: Partial<CameraCatalogDevice> & Pick<CameraCatalogDevice, 'id'>,
): CameraCatalogDevice {
  return {
    vehicleId: 'veh-1',
    protocol: 'meitrack',
    status: 'ACTIVE',
    imei: '867191086416152',
    ...partial,
  };
}

describe('alignCameraCatalog', () => {
  it('marks a media-OFFLINE camera online when the map device is ONLINE', () => {
    const rows = alignCameraCatalog({
      channels: [channel({ id: 'c1', deviceId: 'dev-1', online: false })],
      devices: [device({ id: 'dev-1' })],
      statuses: [{ deviceId: 'dev-1', state: 'ONLINE' }],
      fixes: [],
      nowMs: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.online).toBe(true);
    expect(onlineCameraDeviceCount(rows)).toBe(1);
  });

  it('marks a REGISTERED camera offline when the map device is OFFLINE', () => {
    const rows = alignCameraCatalog({
      channels: [channel({ id: 'c1', deviceId: 'dev-1', online: true })],
      devices: [device({ id: 'dev-1' })],
      statuses: [{ deviceId: 'dev-1', state: 'OFFLINE' }],
      fixes: [
        { vehicleId: 'veh-1', capturedAt: new Date(NOW - MOTION_FRESH_MS - 60_000).toISOString() },
      ],
      nowMs: NOW,
    });
    expect(rows[0]?.online).toBe(false);
    expect(onlineCameraDeviceCount(rows)).toBe(0);
  });

  it('treats a fresh GPS fix as online, matching the live map', () => {
    const rows = alignCameraCatalog({
      channels: [channel({ id: 'c1', deviceId: 'dev-1', online: false })],
      devices: [device({ id: 'dev-1' })],
      statuses: [{ deviceId: 'dev-1', state: 'OFFLINE' }],
      fixes: [{ vehicleId: 'veh-1', capturedAt: new Date(NOW - 30_000).toISOString() }],
      nowMs: NOW,
    });
    expect(rows[0]?.online).toBe(true);
  });

  it('counts eight map-online MDVRs when only five channels were registered', () => {
    const channels = Array.from({ length: 5 }, (_, i) =>
      channel({
        id: `c${i}`,
        deviceId: `dev-${i}`,
        sourceId: `veh-${i}`,
        sourceLabel: `Truck ${i}`,
        online: false,
      }),
    );
    const devices = Array.from({ length: 8 }, (_, i) =>
      device({
        id: `dev-${i}`,
        vehicleId: `veh-${i}`,
        imei: `86719108641615${i}`,
      }),
    );
    const statuses = devices.map((d) => ({ deviceId: d.id, state: 'ONLINE' as const }));
    const rows = alignCameraCatalog({
      channels,
      devices,
      statuses,
      fixes: [],
      vehicleLabel: (id) => `Truck ${id}`,
      nowMs: NOW,
    });
    // The five registered rows stay one lens each; the three missing units get CH1+CH2.
    expect(rows.filter((r) => r.deviceId === 'dev-6')).toHaveLength(2);
    expect(onlineCameraDeviceCount(rows)).toBe(8);
    expect(rows.every((r) => r.online)).toBe(true);
  });

  it('does not invent cameras for a GPS-only tracker', () => {
    const rows = alignCameraCatalog({
      channels: [],
      devices: [device({ id: 'trk', protocol: 'gt06', vehicleId: 'veh-9' })],
      statuses: [{ deviceId: 'trk', state: 'ONLINE' }],
      fixes: [],
      nowMs: NOW,
    });
    expect(rows).toHaveLength(0);
    expect(onlineCameraDeviceCount(rows)).toBe(0);
  });

  it('counts two lenses on one vehicle as a single online device', () => {
    const rows = [
      channel({ id: 'a', deviceId: 'dev-1', sourceId: 'veh-1', logicalChannel: 1 }),
      channel({ id: 'b', deviceId: 'dev-1', sourceId: 'veh-1', logicalChannel: 2 }),
    ];
    expect(onlineCameraDeviceCount(rows)).toBe(1);
  });
});
