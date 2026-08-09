import { describe, expect, it } from 'vitest';

import { type LivePosition, mergeLivePositions } from '@/hooks/useLiveTracking';
import type { MapVehicle } from '@/types/fleet.types';

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
  },
];

const livePositions = new Map<string, LivePosition>([
  [
    'v1',
    {
      vehicleId: 'v1',
      latitude: 35.72,
      longitude: 51.32,
      speedKph: 75,
      headingDeg: 95,
      capturedAt: '2026-08-08T10:00:00Z',
      quality: 'VALID',
    },
  ],
]);

describe('mergeLivePositions', () => {
  it('returns original array when no live positions', () => {
    const result = mergeLivePositions(baseVehicles, new Map());
    expect(result).toEqual(baseVehicles);
  });

  it('patches the vehicle with a live position', () => {
    const result = mergeLivePositions(baseVehicles, livePositions);
    const v1 = result.find((v) => v.id === 'v1')!;
    expect(v1.lat).toBe(35.72);
    expect(v1.lng).toBe(51.32);
    expect(v1.speed).toBe(75);
    expect(v1.heading).toBe(95);
    expect(v1.updatedAt).toBe('2026-08-08T10:00:00Z');
  });

  it('leaves vehicles without live positions untouched', () => {
    const result = mergeLivePositions(baseVehicles, livePositions);
    const v2 = result.find((v) => v.id === 'v2')!;
    expect(v2.lat).toBe(35.8);
    expect(v2.speed).toBe(0);
  });

  it('preserves non-position fields (label, state, type)', () => {
    const result = mergeLivePositions(baseVehicles, livePositions);
    const v1 = result.find((v) => v.id === 'v1')!;
    expect(v1.label).toBe('Truck-1');
    expect(v1.state).toBe('driving');
    expect(v1.type).toBe('truck');
  });
});
