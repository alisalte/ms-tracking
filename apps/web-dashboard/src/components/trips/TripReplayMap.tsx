import {
  type GeoJSONSource,
  LngLatBounds as MaplibreLngLatBounds,
  Map as MaplibreMap,
  Marker as MaplibreMarker,
} from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { markerDataUrl, paintVehicleMarker } from '@/lib/map-markers';
import { mapAccents, status } from '@/theme/palette';
import type { TripEvent, TripWaypoint } from '@/types/fleet.types';

interface TripReplayMapProps {
  /** Ordered position samples of the trip track. */
  waypoints: TripWaypoint[];
  /** Layered events to mark on the map (stops / idle / overspeed). */
  events: TripEvent[];
  /** Current replay index — the animated vehicle marker follows it. */
  index: number;
}

/** Event type → marker color (stop=amber, idle=slate, overspeed=red). */
const EVENT_COLOR: Record<TripEvent['type'], string> = {
  stop: status.amber,
  idle: status.slate,
  overspeed: status.red,
  geofence: mapAccents.geofence,
};

const TEHRAN: [number, number] = [51.389, 35.689];
const MAP_HEIGHT_PX = 360;

const EMPTY_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/** GeoJSON [lng, lat] for waypoints with finite in-range coordinates. */
function routeCoordinates(waypoints: readonly TripWaypoint[]): [number, number][] {
  const coords: [number, number][] = [];
  for (const w of waypoints) {
    const lat = Number(w.lat);
    const lng = Number(w.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    coords.push([lng, lat]);
  }
  return coords;
}

function routeCollection(coords: [number, number][]): GeoJSON.FeatureCollection {
  if (coords.length < 2) return EMPTY_COLLECTION;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: {},
      },
    ],
  };
}

/**
 * TripReplayMap — a dedicated replay map for a single trip (TailAdmin port).
 *
 * Unlike the live FleetMap, this renders a static trip track: a solid cyan
 * polyline (UI_UX_Design.md §0.2 `mapAccents.selectedRoute`) of the waypoints,
 * fixed markers for each stop/idle/overspeed event, and a single animated
 * vehicle marker that follows the current replay index (heading-rotated arrow).
 * The map fits to the track bounds on load.
 */
export function TripReplayMap({ waypoints, events, index }: TripReplayMapProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const eventMarkersRef = useRef<MaplibreMarker[]>([]);
  const vehicleMarkerRef = useRef<MaplibreMarker | null>(null);
  const waypointsRef = useRef(waypoints);
  const eventsRef = useRef(events);
  waypointsRef.current = waypoints;
  eventsRef.current = events;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const first = routeCoordinates(waypointsRef.current)[0] ?? TEHRAN;

    const map = new MaplibreMap({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: first,
      zoom: 12,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    // Empty FeatureCollection is valid GeoJSON; an empty LineString is not and
    // MapLibre refuses the source — the whole map then fails to render.
    map.on('load', () => {
      if (mapRef.current !== map) return;
      map.resize();
      if (!map.getSource('route')) {
        map.addSource('route', { type: 'geojson', data: EMPTY_COLLECTION });
        map.addLayer({
          id: 'route-casing',
          type: 'line',
          source: 'route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#0F172A', 'line-width': 7, 'line-opacity': 0.35 },
        });
        map.addLayer({
          id: 'route',
          type: 'line',
          source: 'route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': mapAccents.selectedRoute, 'line-width': 4, 'line-opacity': 1 },
        });
      }
      paintTrack(map, waypointsRef.current, eventsRef.current, eventMarkersRef);
    });

    return () => {
      for (const m of eventMarkersRef.current) m.remove();
      eventMarkersRef.current = [];
      vehicleMarkerRef.current?.remove();
      vehicleMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => paintTrack(map, waypoints, events, eventMarkersRef);
    if (map.loaded()) apply();
    else map.once('load', apply);
  }, [waypoints, events]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const wp = waypoints[index];
    if (!wp) return;
    const lat = Number(wp.lat);
    const lng = Number(wp.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const place = () => {
      if (mapRef.current !== map) return;
      const heading = Number.isFinite(wp.heading) ? wp.heading : 0;
      const el = document.createElement('div');
      el.className = 'fv-vehicle-marker';
      paintVehicleMarker(el, 'car', mapAccents.selectedRoute, {
        heading,
        id: 'trip-replay',
      });
      el.setAttribute('aria-label', t('trips.replay.vehicle'));
      vehicleMarkerRef.current?.remove();
      const marker = new MaplibreMarker({ element: el, anchor: 'center' }).setLngLat([lng, lat]);
      marker.addTo(map);
      vehicleMarkerRef.current = marker;
    };

    if (map.loaded()) place();
    else map.once('load', place);
  }, [index, waypoints, t]);

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg"
      dir="ltr"
      style={{ height: MAP_HEIGHT_PX }}
    >
      <div
        ref={containerRef}
        data-testid="trip-replay-map"
        style={{ width: '100%', height: MAP_HEIGHT_PX }}
      />
      <div className="pointer-events-none absolute bottom-1.5 start-1.5 z-10 flex flex-wrap items-center gap-3 rounded-lg bg-white/85 px-2 py-1 backdrop-blur-sm">
        {(
          [
            ['route', mapAccents.selectedRoute],
            ['stop', status.amber],
            ['idle', status.slate],
            ['overspeed', status.red],
          ] as const
        ).map(([key, color]) => (
          <span key={key} className="flex items-center gap-1">
            <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-xs text-gray-500 dark:text-graydark-600">
              {t(`trips.replay.legend.${key}`)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function paintTrack(
  map: MaplibreMap,
  waypoints: readonly TripWaypoint[],
  events: readonly TripEvent[],
  eventMarkersRef: { current: MaplibreMarker[] },
): void {
  const coords = routeCoordinates(waypoints);
  const source = map.getSource('route') as GeoJSONSource | undefined;
  if (!source) return;
  source.setData(routeCollection(coords));

  for (const m of eventMarkersRef.current) m.remove();
  eventMarkersRef.current = [];
  for (const e of events) {
    if (e.lat === undefined || e.lng === undefined) continue;
    const el = document.createElement('img');
    el.src = markerDataUrl(EVENT_COLOR[e.type]);
    el.alt = `${e.type} marker`;
    el.style.width = '16px';
    el.style.height = '16px';
    const marker = new MaplibreMarker({ element: el, anchor: 'center' }).setLngLat([e.lng, e.lat]);
    marker.addTo(map);
    eventMarkersRef.current.push(marker);
  }

  if (coords.length < 2) return;
  const firstCoord = coords[0];
  if (!firstCoord) return;
  const bounds = coords.reduce(
    (b, c) => b.extend(c),
    new MaplibreLngLatBounds(firstCoord, firstCoord),
  );
  map.resize();
  map.stop();
  map.fitBounds(bounds, { padding: 40, maxZoom: 16, duration: 0 });
}
