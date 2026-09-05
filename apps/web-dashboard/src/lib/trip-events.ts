import type { TripEvent, TripWaypoint } from '@/types/fleet.types';

/** Default posted speed limit used to flag overspeed markers (km/h). */
export const TRIP_SPEED_LIMIT_KMH = 100;

export function nearestWaypoint(
  waypoints: readonly TripWaypoint[],
  ts: string,
): TripWaypoint | undefined {
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t) || waypoints.length === 0) return undefined;
  let best: TripWaypoint | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  for (const w of waypoints) {
    const d = Math.abs(new Date(w.ts).getTime() - t);
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  return best;
}

/** Idle windows from the API have no coordinates — pin them to the nearest sample. */
export function attachEventCoordinates(
  events: readonly TripEvent[],
  waypoints: readonly TripWaypoint[],
): TripEvent[] {
  return events.map((e) => {
    if (e.lat != null && e.lng != null) return e;
    const w = nearestWaypoint(waypoints, e.ts);
    return w ? { ...e, lat: w.lat, lng: w.lng } : e;
  });
}

/** Collapse consecutive overspeed samples into one map/timeline marker. */
export function overspeedEvents(
  waypoints: readonly TripWaypoint[],
  limitKmh = TRIP_SPEED_LIMIT_KMH,
): TripEvent[] {
  const out: TripEvent[] = [];
  for (let i = 0; i < waypoints.length; i++) {
    const w = waypoints[i];
    if (!w || w.speed <= limitKmh) continue;
    const prev = out[out.length - 1];
    if (
      prev?.type === 'overspeed' &&
      Math.abs(new Date(w.ts).getTime() - new Date(prev.ts).getTime()) < 180_000
    ) {
      continue;
    }
    out.push({
      id: `overspeed-${i}`,
      ts: w.ts,
      type: 'overspeed',
      lat: w.lat,
      lng: w.lng,
      label: `${Math.round(w.speed)} km/h`,
    });
  }
  return out;
}

export function speedLineColor(kmh: number): string {
  if (kmh <= 2) return '#94A3B8';
  if (kmh < 40) return '#22C55E';
  if (kmh < 80) return '#465FFB';
  if (kmh <= 100) return '#F59E0B';
  return '#DC2626';
}

const EMPTY_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

function validLngLat(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  );
}

/** Consecutive samples sharing a speed band, skipping zero-length dwells. */
export function speedSegmentCollection(
  waypoints: readonly TripWaypoint[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  let color: string | null = null;
  let coords: [number, number][] = [];

  const flush = () => {
    if (coords.length >= 2 && color) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { color },
      });
    }
    coords = [];
    color = null;
  };

  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1];
    const b = waypoints[i];
    if (!a || !b || !validLngLat(a.lat, a.lng) || !validLngLat(b.lat, b.lng)) {
      flush();
      continue;
    }
    if (a.lng === b.lng && a.lat === b.lat) continue;
    const nextColor = speedLineColor((a.speed + b.speed) / 2);
    if (color !== nextColor) {
      flush();
      color = nextColor;
      coords = [
        [a.lng, a.lat],
        [b.lng, b.lat],
      ];
    } else {
      coords.push([b.lng, b.lat]);
    }
  }
  flush();
  return features.length === 0 ? EMPTY_COLLECTION : { type: 'FeatureCollection', features };
}

/** One continuous LineString of the whole trip (overview path). */
export function fullRouteCollection(waypoints: readonly TripWaypoint[]): GeoJSON.FeatureCollection {
  const coordinates: [number, number][] = [];
  for (const w of waypoints) {
    if (!validLngLat(w.lat, w.lng)) continue;
    const prev = coordinates[coordinates.length - 1];
    if (prev && prev[0] === w.lng && prev[1] === w.lat) continue;
    coordinates.push([w.lng, w.lat]);
  }
  if (coordinates.length < 2) return EMPTY_COLLECTION;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties: {},
      },
    ],
  };
}

/** Traveled portion of the track up to `index` (inclusive). */
export function progressCollection(
  waypoints: readonly TripWaypoint[],
  index: number,
): GeoJSON.FeatureCollection {
  const end = Math.max(0, Math.min(index, waypoints.length - 1));
  const coordinates: [number, number][] = [];
  for (let i = 0; i <= end; i++) {
    const w = waypoints[i];
    if (!w || !validLngLat(w.lat, w.lng)) continue;
    coordinates.push([w.lng, w.lat]);
  }
  if (coordinates.length < 2) return EMPTY_COLLECTION;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties: {},
      },
    ],
  };
}

/** Idle/stop from the API plus derived overspeed markers, pinned to the track. */
export function decorateTripEvents(
  events: readonly TripEvent[],
  waypoints: readonly TripWaypoint[],
): TripEvent[] {
  return attachEventCoordinates([...events, ...overspeedEvents(waypoints)], waypoints).sort(
    (a, b) => a.ts.localeCompare(b.ts),
  );
}
