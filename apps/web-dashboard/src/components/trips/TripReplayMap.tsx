import { Box, Stack, Typography } from '@mui/material';
import {
  LngLatBounds as MaplibreLngLatBounds,
  Map as MaplibreMap,
  Marker as MaplibreMarker,
} from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { headingArrowDataUrl, markerDataUrl } from '@/lib/map-markers';
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

/**
 * TripReplayMap — a dedicated replay map for a single trip.
 *
 * Unlike the live FleetMap, this renders a static trip track: a green dashed
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

  // Initialize the map once + draw the route polyline + event markers.
  useEffect(() => {
    const first = waypoints[0];
    if (!containerRef.current || mapRef.current || !first) return;

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
      center: [first.lng, first.lat],
      zoom: 12,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    const draw = () => {
      // Route polyline (green, dashed).
      const coords = waypoints.map((w) => [w.lng, w.lat]) as [number, number][];
      map.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: {},
        },
      });
      map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': mapAccents.selectedRoute,
          'line-width': 3,
          'line-dasharray': [2, 1],
        },
      });

      // Event markers (stop / idle / overspeed / geofence). Events whose
      // projection carries no position (idle windows) stay on the timeline only.
      for (const e of events) {
        if (e.lat === undefined || e.lng === undefined) continue;
        const el = document.createElement('img');
        el.src = markerDataUrl(EVENT_COLOR[e.type]);
        el.alt = `${e.type} marker`;
        el.style.width = '16px';
        el.style.height = '16px';
        const m = new MaplibreMarker({ element: el, anchor: 'center' }).setLngLat([e.lng, e.lat]);
        m.addTo(map);
        eventMarkersRef.current.push(m);
      }

      // Fit to the whole track so the route is fully visible.
      const firstCoord = coords[0];
      const bounds = firstCoord
        ? coords.reduce((b, c) => b.extend(c), new MaplibreLngLatBounds(firstCoord, firstCoord))
        : new MaplibreLngLatBounds([0, 0], [0, 0]);
      map.fitBounds(bounds, { padding: 40 });
    };

    if (map.loaded()) draw();
    else map.once('load', draw);

    return () => {
      for (const m of eventMarkersRef.current) m.remove();
      eventMarkersRef.current = [];
      vehicleMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [waypoints, events]);

  // Move the animated vehicle marker to the current replay index.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const wp = waypoints[index];
    if (!wp) return;

    const place = () => {
      const el = document.createElement('img');
      el.src = headingArrowDataUrl(mapAccents.selectedRoute, wp.heading);
      el.alt = t('trips.replay.vehicle');
      el.style.width = '26px';
      el.style.height = '26px';

      if (vehicleMarkerRef.current) vehicleMarkerRef.current.remove();
      const marker = new MaplibreMarker({ element: el, anchor: 'center' }).setLngLat([
        wp.lng,
        wp.lat,
      ]);
      marker.addTo(map);
      vehicleMarkerRef.current = marker;
    };

    if (map.loaded()) place();
    else map.once('load', place);
  }, [index, waypoints, t]);

  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 320,
        borderRadius: 1,
        overflow: 'hidden',
      }}
    >
      <Box ref={containerRef} sx={{ width: '100%', height: '100%' }} />
      {/* Legend overlay (§0.7: pair color with label). */}
      <Stack
        direction="row"
        gap={1.5}
        sx={{
          position: 'absolute',
          bottom: 6,
          start: 6,
          backgroundColor: 'rgba(255,255,255,0.85)',
          px: 1,
          py: 0.5,
          borderRadius: 1,
          backdropFilter: 'blur(4px)',
        }}
      >
        {(
          [
            ['route', mapAccents.selectedRoute],
            ['stop', status.amber],
            ['idle', status.slate],
            ['overspeed', status.red],
          ] as const
        ).map(([key, color]) => (
          <Stack key={key} direction="row" alignItems="center" gap={0.25}>
            <Box
              component="span"
              sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color }}
            />
            <Typography variant="caption" color="text.secondary">
              {t(`trips.replay.legend.${key}`)}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
