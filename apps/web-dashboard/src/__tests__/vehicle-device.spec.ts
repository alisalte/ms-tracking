import { describe, expect, it } from 'vitest';

import { pickVehicleDevice } from '@/lib/vehicle-device';

describe('pickVehicleDevice', () => {
  it('follows the Meitrack camera even when a separate tracker is online', () => {
    const picked = pickVehicleDevice([
      {
        deviceId: 'tracker',
        protocol: 'gt06',
        state: 'ONLINE' as const,
        lastSeenAt: '2026-10-17T12:00:00Z',
      },
      {
        deviceId: 'mdvr',
        protocol: 'meitrack',
        state: 'OFFLINE' as const,
        lastSeenAt: '2026-10-17T08:00:00Z',
      },
    ]);
    expect(picked?.deviceId).toBe('mdvr');
  });

  it('prefers the online Meitrack when several cameras are bound', () => {
    const picked = pickVehicleDevice([
      { deviceId: 'old', protocol: 'meitrack', state: 'OFFLINE' as const },
      { deviceId: 'live', protocol: 'meitrack', state: 'ONLINE' as const },
    ]);
    expect(picked?.deviceId).toBe('live');
  });

  it('keeps a tracker online when the vehicle has no camera', () => {
    const picked = pickVehicleDevice([
      { deviceId: 'a', protocol: 'gt06', state: 'OFFLINE' as const },
      { deviceId: 'b', protocol: 'jt808', state: 'ONLINE' as const },
    ]);
    expect(picked?.deviceId).toBe('b');
  });
});
