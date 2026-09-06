import { describe, expect, it } from 'vitest';

import { applyDemoStatuses } from '@/lib/map-demo-status';
import type { MapVehicle } from '@/types/fleet.types';

function car(id: string): MapVehicle {
  return {
    id,
    label: id,
    state: 'driving',
    lat: 35.7,
    lng: 51.3,
    heading: 0,
    speed: 40,
    presence: 'ONLINE',
  };
}

describe('applyDemoStatuses', () => {
  it('assigns eight vehicles distinct headings and mixed statuses', () => {
    const out = applyDemoStatuses(Array.from({ length: 8 }, (_, i) => car(`v${i}`)));
    expect(out.map((v) => v.heading)).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    expect(out.map((v) => v.state)).toEqual([
      'driving',
      'idle',
      'overspeed',
      'stopped',
      'offline',
      'stopped',
      'offline',
      'driving',
    ]);
    expect(out.map((v) => v.presence)).toEqual([
      'ONLINE',
      'ONLINE',
      'ONLINE',
      'ONLINE',
      'OFFLINE',
      'STALE',
      'UNKNOWN',
      'ONLINE',
    ]);
  });
});
