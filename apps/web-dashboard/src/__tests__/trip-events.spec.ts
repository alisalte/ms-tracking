import { describe, expect, it } from 'vitest';

import {
  attachEventCoordinates,
  decorateTripEvents,
  fullRouteCollection,
  nearestWaypoint,
  overspeedEvents,
  progressCollection,
  speedLineColor,
  speedSegmentCollection,
} from '@/lib/trip-events';
import type { TripEvent, TripWaypoint } from '@/types/fleet.types';

function wp(partial: Partial<TripWaypoint> & Pick<TripWaypoint, 'ts'>): TripWaypoint {
  return {
    lat: 35.7,
    lng: 51.4,
    speed: 40,
    heading: 90,
    ...partial,
  };
}

describe('nearestWaypoint', () => {
  const points = [
    wp({ ts: '2026-08-15T08:00:00Z', lat: 35.7, lng: 51.4 }),
    wp({ ts: '2026-08-15T08:30:00Z', lat: 35.72, lng: 51.42 }),
  ];

  it('returns the closest sample in time', () => {
    const hit = nearestWaypoint(points, '2026-08-15T08:10:00Z');
    expect(hit?.lat).toBe(35.7);
    expect(hit?.lng).toBe(51.4);
  });

  it('returns undefined for an empty track', () => {
    expect(nearestWaypoint([], '2026-08-15T08:10:00Z')).toBeUndefined();
  });
});

describe('attachEventCoordinates', () => {
  it('pins idle events without coordinates to the nearest waypoint', () => {
    const events: TripEvent[] = [
      { id: 'idle-0', ts: '2026-08-15T08:10:00Z', type: 'idle', label: '5 min', durationMin: 5 },
    ];
    const [idle] = attachEventCoordinates(events, [
      wp({ ts: '2026-08-15T08:00:00Z', lat: 35.7, lng: 51.4 }),
      wp({ ts: '2026-08-15T08:30:00Z', lat: 35.72, lng: 51.42 }),
    ]);
    expect(idle?.lat).toBe(35.7);
    expect(idle?.lng).toBe(51.4);
  });

  it('keeps existing stop coordinates', () => {
    const events: TripEvent[] = [
      {
        id: 'stop-0',
        ts: '2026-08-15T08:20:00Z',
        type: 'stop',
        lat: 35.71,
        lng: 51.41,
        label: '10 min',
        durationMin: 10,
      },
    ];
    const [stop] = attachEventCoordinates(events, [wp({ ts: '2026-08-15T08:00:00Z' })]);
    expect(stop?.lat).toBe(35.71);
  });
});

describe('overspeedEvents', () => {
  it('collapses consecutive overspeed samples into one marker', () => {
    const events = overspeedEvents([
      wp({ ts: '2026-08-15T08:00:00Z', speed: 40 }),
      wp({ ts: '2026-08-15T08:01:00Z', speed: 112, lat: 35.75, lng: 51.41 }),
      wp({ ts: '2026-08-15T08:02:00Z', speed: 118, lat: 35.751, lng: 51.411 }),
      wp({ ts: '2026-08-15T08:10:00Z', speed: 40 }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'overspeed',
      lat: 35.75,
      lng: 51.41,
      label: '112 km/h',
    });
  });
});

describe('speedLineColor', () => {
  it('bands stopped, urban, highway, and overspeed', () => {
    expect(speedLineColor(0)).toBe('#94A3B8');
    expect(speedLineColor(25)).toBe('#22C55E');
    expect(speedLineColor(55)).toBe('#465FFB');
    expect(speedLineColor(90)).toBe('#F59E0B');
    expect(speedLineColor(112)).toBe('#DC2626');
  });
});

describe('speedSegmentCollection', () => {
  it('merges consecutive samples in the same speed band into one LineString', () => {
    const col = speedSegmentCollection([
      wp({ ts: '2026-08-15T08:00:00Z', lat: 35.7, lng: 51.4, speed: 40 }),
      wp({ ts: '2026-08-15T08:01:00Z', lat: 35.71, lng: 51.41, speed: 42 }),
      wp({ ts: '2026-08-15T08:02:00Z', lat: 35.72, lng: 51.42, speed: 38 }),
    ]);
    expect(col.features).toHaveLength(1);
    const geom = col.features[0]?.geometry as GeoJSON.LineString;
    expect(geom.coordinates).toHaveLength(3);
    expect(col.features[0]?.properties?.color).toBe('#465FFB');
  });

  it('skips zero-length dwells so a stop does not become a dot', () => {
    const col = speedSegmentCollection([
      wp({ ts: 'a', lat: 35.7, lng: 51.4, speed: 0 }),
      wp({ ts: 'b', lat: 35.7, lng: 51.4, speed: 0 }),
      wp({ ts: 'c', lat: 35.71, lng: 51.41, speed: 40 }),
    ]);
    expect(col.features).toHaveLength(1);
  });
});

describe('fullRouteCollection', () => {
  it('emits one continuous LineString for the whole trip', () => {
    const col = fullRouteCollection([
      wp({ ts: 'a', lat: 35.7, lng: 51.4 }),
      wp({ ts: 'b', lat: 35.7, lng: 51.4 }),
      wp({ ts: 'c', lat: 35.71, lng: 51.41 }),
    ]);
    expect(col.features).toHaveLength(1);
    const geom = col.features[0]?.geometry as GeoJSON.LineString;
    expect(geom.coordinates).toEqual([
      [51.4, 35.7],
      [51.41, 35.71],
    ]);
  });
});

describe('progressCollection', () => {
  it('keeps the traveled prefix up to index', () => {
    const col = progressCollection(
      [
        wp({ ts: 'a', lat: 35.7, lng: 51.4 }),
        wp({ ts: 'b', lat: 35.71, lng: 51.41 }),
        wp({ ts: 'c', lat: 35.72, lng: 51.42 }),
      ],
      1,
    );
    const geom = col.features[0]?.geometry as GeoJSON.LineString;
    expect(geom.coordinates).toEqual([
      [51.4, 35.7],
      [51.41, 35.71],
    ]);
  });
});

describe('decorateTripEvents', () => {
  it('merges API idle/stop with derived overspeed and sorts by time', () => {
    const events = decorateTripEvents(
      [{ id: 'idle-0', ts: '2026-08-15T08:01:00Z', type: 'idle', label: '5 min', durationMin: 5 }],
      [
        wp({ ts: '2026-08-15T08:00:00Z', lat: 35.7, lng: 51.4, speed: 40 }),
        wp({ ts: '2026-08-15T08:12:00Z', lat: 35.73, lng: 51.43, speed: 120 }),
      ],
    );
    expect(events.map((e) => e.type)).toEqual(['idle', 'overspeed']);
    expect(events[0]?.lat).toBe(35.7);
    expect(events[1]?.lat).toBe(35.73);
  });
});
