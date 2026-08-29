import { describe, expect, it } from 'vitest';

import { cluster, INDIVIDUAL_FROM_ZOOM } from '@/lib/map-cluster';
import type { MapVehicle } from '@/types/fleet.types';

function veh(id: string, lat: number, lng: number, type: MapVehicle['type'] = 'car'): MapVehicle {
  return {
    id,
    label: id,
    state: 'driving',
    lat,
    lng,
    heading: 0,
    speed: 30,
    type,
    presence: 'ONLINE',
  };
}

/** Tehran depot — three vehicles a few metres apart. */
const DEPOT: MapVehicle[] = [
  veh('a', 35.652, 51.405, 'truck'),
  veh('b', 35.65201, 51.40502, 'van'),
  veh('c', 35.65199, 51.40498, 'car'),
];

const TEHRAN_BBOX: [number, number, number, number] = [50.5, 35.2, 52.0, 36.0];

describe('cluster', () => {
  it('shows individual 3D-capable points at the live-map default zoom', () => {
    const result = cluster(DEPOT, TEHRAN_BBOX, INDIVIDUAL_FROM_ZOOM);
    expect(result.every((f) => f.kind === 'point')).toBe(true);
    expect(result).toHaveLength(3);
    const types = result
      .filter((f): f is Extract<typeof f, { kind: 'point' }> => f.kind === 'point')
      .map((f) => f.vehicle.type)
      .sort();
    expect(types).toEqual(['car', 'truck', 'van']);
  });

  it('does not cluster a small demo fleet even when zoomed out', () => {
    const result = cluster(DEPOT, TEHRAN_BBOX, 8);
    expect(result.every((f) => f.kind === 'point')).toBe(true);
    expect(result).toHaveLength(3);
  });

  it('merges depot-mates into a count bubble when zoomed out of a large fleet', () => {
    const crowd = Array.from({ length: 80 }, (_, i) =>
      veh(`v${i}`, 35.652 + (i % 8) * 0.0002, 51.405 + Math.floor(i / 8) * 0.0002, 'car'),
    );
    const result = cluster(crowd, TEHRAN_BBOX, 8);
    const clusters = result.filter((f) => f.kind === 'cluster');
    expect(clusters.length).toBeGreaterThanOrEqual(1);
  });

  it('drops vehicles without a GPS fix so they do not pile at 0,0', () => {
    const result = cluster(
      [...DEPOT, veh('ghost', 0, 0)],
      [-180, -90, 180, 90],
      INDIVIDUAL_FROM_ZOOM,
    );
    expect(result).toHaveLength(3);
    expect(result.every((f) => f.kind === 'point' && f.vehicle.id !== 'ghost')).toBe(true);
  });

  it('uses updated coordinates after a live position delta', () => {
    cluster(DEPOT, TEHRAN_BBOX, 8);
    const moved = [veh('a', 35.9, 51.7, 'truck')];
    const result = cluster(moved, TEHRAN_BBOX, INDIVIDUAL_FROM_ZOOM);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'point', lat: 35.9, lng: 51.7 });
  });
});
