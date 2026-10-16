import { describe, expect, it } from 'vitest';

import { type DeviceStatus, type LivePosition, mergeLivePositions } from '@/hooks/useLiveTracking';
import type { MapVehicle } from '@/types/fleet.types';

const nowIso = () => new Date().toISOString();

const baseVehicles: MapVehicle[] = [
  {
    id: 'v1',
    label: 'Truck-1',
    state: 'driving',
    lat: 35.7,
    lng: 51.3,
    heading: 90,
    speed: 60,
    type: 'truck',
    presence: 'ONLINE',
    updatedAt: nowIso(),
  },
  {
    id: 'v2',
    label: 'Truck-2',
    state: 'idle',
    lat: 35.8,
    lng: 51.4,
    heading: 0,
    speed: 0,
    type: 'van',
    presence: 'ONLINE',
    updatedAt: nowIso(),
  },
];

function liveFix(
  vehicleId: string,
  overrides: Partial<LivePosition> = {},
): Map<string, LivePosition> {
  return new Map([
    [
      vehicleId,
      {
        vehicleId,
        latitude: 35.72,
        longitude: 51.32,
        speedKph: 75,
        headingDeg: 95,
        capturedAt: nowIso(),
        quality: 'VALID',
        ...overrides,
      },
    ],
  ]);
}

const livePositions = liveFix('v1');

describe('mergeLivePositions', () => {
  it('returns original array when no live positions', () => {
    const result = mergeLivePositions(baseVehicles, new Map());
    expect(result).toEqual(baseVehicles);
  });

  it('patches the vehicle with a live position', () => {
    const capturedAt = nowIso();
    const result = mergeLivePositions(baseVehicles, liveFix('v1', { capturedAt }));
    const v1 = result.find((v) => v.id === 'v1');
    expect(v1).toBeDefined();
    expect(v1?.lat).toBe(35.72);
    expect(v1?.lng).toBe(51.32);
    expect(v1?.speed).toBe(75);
    expect(v1?.heading).toBe(95);
    expect(v1?.updatedAt).toBe(capturedAt);
  });

  it('leaves vehicles without live positions untouched', () => {
    const result = mergeLivePositions(baseVehicles, livePositions);
    const v2 = result.find((v) => v.id === 'v2');
    expect(v2).toBeDefined();
    expect(v2?.lat).toBe(35.8);
    expect(v2?.speed).toBe(0);
  });

  it('preserves non-position fields (label, state, type)', () => {
    const result = mergeLivePositions(baseVehicles, livePositions);
    const v1 = result.find((v) => v.id === 'v1');
    expect(v1).toBeDefined();
    expect(v1?.label).toBe('Truck-1');
    expect(v1?.state).toBe('driving'); // moving live fix keeps the vehicle "driving"
    expect(v1?.type).toBe('truck');
  });
});

describe('mergeLivePositions with device-status deltas (§18/§19)', () => {
  // WS device.status events are keyed by deviceId — MapVehicle.deviceId joins.
  const statuses = new Map<string, DeviceStatus>([
    ['dev-1', { deviceId: 'dev-1', state: 'OFFLINE', lastSeenAt: nowIso() }],
    ['dev-2', { deviceId: 'dev-2', state: 'STALE', lastSeenAt: nowIso() }],
  ]);
  const withDevices: MapVehicle[] = [
    {
      ...baseVehicles[0],
      deviceId: 'dev-1',
      presence: 'ONLINE',
      lastSeenAt: nowIso(),
    },
    {
      ...baseVehicles[1],
      deviceId: 'dev-2',
      presence: 'ONLINE',
      lastSeenAt: nowIso(),
    },
  ];

  it('applies presence + lastSeenAt from the WS status map (keyed by deviceId)', () => {
    const result = mergeLivePositions(withDevices, new Map(), statuses);
    const v1 = result.find((v) => v.id === 'v1');
    const v2 = result.find((v) => v.id === 'v2');
    expect(v1?.presence).toBe('OFFLINE');
    expect(v1?.state).toBe('offline'); // OFFLINE ⇒ offline movement state
    expect(v1?.speed).toBe(0); // no live speed while OFFLINE
    expect(v2?.presence).toBe('STALE');
    expect(v2?.state).toBe('stopped'); // STALE ⇒ stopped movement state
    expect(v2?.speed).toBe(0); // no live speed while STALE
  });

  it('returns the original array when there are no live deltas at all', () => {
    const result = mergeLivePositions(withDevices, new Map(), new Map());
    expect(result).toBe(withDevices);
  });

  it('leaves vehicles without a status update untouched', () => {
    const lone: MapVehicle[] = [
      {
        ...baseVehicles[0],
        deviceId: 'dev-x',
        presence: 'ONLINE',
        lastSeenAt: nowIso(),
      },
    ];
    const result = mergeLivePositions(lone, new Map(), statuses);
    expect(result[0]?.presence).toBe('ONLINE');
  });

  it('derives the movement state from a live position while ONLINE', () => {
    const result = mergeLivePositions(withDevices, liveFix('v1'), new Map());
    const v1 = result.find((v) => v.id === 'v1');
    expect(v1?.state).toBe('driving');
    expect(v1?.speed).toBe(75);
    expect(v1?.presence).toBe('ONLINE');
  });

  it('fresh live fix upgrades a lagging OFFLINE status so list and drawer agree', () => {
    const result = mergeLivePositions(withDevices, liveFix('v1'), statuses);
    const v1 = result.find((v) => v.id === 'v1');
    expect(v1?.presence).toBe('ONLINE');
    expect(v1?.state).toBe('driving');
    expect(v1?.speed).toBe(75);
  });

  it('ignores a live fix that teleports across continents', () => {
    const norway = liveFix('v1', {
      latitude: 67.28,
      longitude: 0.2,
      speedKph: 0,
      headingDeg: 238,
    });
    const result = mergeLivePositions(withDevices, norway, new Map());
    const v1 = result.find((v) => v.id === 'v1');
    expect(v1?.lat).toBe(35.7);
    expect(v1?.lng).toBe(51.3);
  });

  it('lets a real live fix replace MDVR junk on the REST bootstrap', () => {
    const junkRest: MapVehicle[] = [
      {
        ...withDevices[0],
        lat: 67.28,
        lng: 0.2,
        updatedAt: nowIso(),
      },
    ];
    const tehran = liveFix('v1', {
      latitude: 35.703,
      longitude: 51.403,
      speedKph: 12,
      headingDeg: 90,
    });
    const result = mergeLivePositions(junkRest, tehran, new Map());
    expect(result[0]?.lat).toBe(35.703);
    expect(result[0]?.lng).toBe(51.403);
  });
});
