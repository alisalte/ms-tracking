/**
 * GeofencePreviewMap — read-only map preview of a saved geofence (Sprint I §47).
 *
 * A single MapLibre instance per dialog: the fence renders as a fill + outline
 * (boundaryGeoJson, or the circle materialized from center+radius) and the map
 * fits its bounds once. No drawing affordances — the edit flow happens in
 * GeofenceFormDialog.
 */
import { type GeoJSONSource, Map as MaplibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';

import { runWhenStyleReady } from '@/lib/map-ready';
import type { Geofence } from '@/types/geofence.types';
import { circleToPolygonRing } from './GeofenceDrawMap';

export function GeofencePreviewMap({
  geofence,
  height = 320,
}: {
  geofence: Geofence;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
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
      center: [51.338, 35.719],
      zoom: 10,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.on('load', () => {
      map.addSource('geofence-preview', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'geofence-preview-fill',
        type: 'fill',
        source: 'geofence-preview',
        paint: { 'fill-color': '#465FFB', 'fill-opacity': 0.12 },
      });
      map.addLayer({
        id: 'geofence-preview-line',
        type: 'line',
        source: 'geofence-preview',
        paint: { 'line-color': '#465FFB', 'line-width': 2 },
      });
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const render = () => {
      const src = map.getSource('geofence-preview') as GeoJSONSource | undefined;
      if (!src) return;
      let geometry: GeoJSON.Polygon | null = null;
      if (geofence.boundaryGeoJson) {
        geometry = geofence.boundaryGeoJson as GeoJSON.Polygon;
      } else if (
        geofence.centerLat !== null &&
        geofence.centerLng !== null &&
        geofence.radiusM !== null
      ) {
        geometry = {
          type: 'Polygon',
          coordinates: [
            circleToPolygonRing(geofence.centerLat, geofence.centerLng, geofence.radiusM),
          ],
        };
      }
      if (!geometry) return;
      src.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry, properties: { name: geofence.name } }],
      });
      const ring = geometry.coordinates[0] ?? [];
      if (ring.length >= 3) {
        const lngs = ring.map((r) => r[0] ?? 0);
        const lats = ring.map((r) => r[1] ?? 0);
        map.fitBounds(
          [
            [Math.min(...lngs), Math.min(...lats)],
            [Math.max(...lngs), Math.max(...lats)],
          ],
          { padding: 40, maxZoom: 16, duration: 400 },
        );
      }
    };
    if (map.isStyleLoaded()) render();
    else runWhenStyleReady(map, render);
  }, [geofence]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height, borderRadius: 8, overflow: 'hidden' }}
      data-testid="geofence-preview-map"
      role="img"
      aria-label={`Geofence ${geofence.name} preview`}
    />
  );
}
