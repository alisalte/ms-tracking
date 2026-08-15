/**
 * GeofenceDrawMap — real-map geofence drawing (Sprint G Parts 33/34).
 *
 * Minimal, backend-faithful drawing on MapLibre GL:
 *   - POLYGON mode: click to add vertices; the boundary preview updates live.
 *     Requires ≥3 vertices (GeoJSON Polygon ring closure is appended).
 *   - CIRCLE mode: click once to set the center; the radius comes from the
 *     form. The boundary is materialized as a 48-vertex polygon approximation
 *     because the backend's operative geometry is the PostGIS polygon
 *     (`ST_Covers(boundary, point)` drives geofence alarms).
 *
 * Existing geofences are rendered read-only (fill + outline). Coordinates are
 * validated client-side ([−90,90]/[−180,180], ≥3 vertices, ≥10 m radius) and
 * the backend re-validates + tenant-scopes on persist.
 */
import {
  type GeoJSONSource,
  Map as MaplibreMap,
} from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';

import type { Geofence } from '@/types/geofence.types';

export type DrawMode = 'polygon' | 'circle' | null;

export interface DrawnGeofence {
  /** GeoJSON polygon ring (closed, ≥4 positions) — always populated. */
  boundary: { type: 'Polygon'; coordinates: number[][][] };
  /** Circle extras (CIRCLE mode only). */
  centerLat?: number;
  centerLng?: number;
  radiusM?: number;
}

interface GeofenceDrawMapProps {
  geofences: readonly Geofence[];
  mode: DrawMode;
  /** Circle radius from the form (meters). */
  circleRadiusM: number;
  onDrawn: (drawn: DrawnGeofence | null) => void;
  height?: number;
}

/** Circle → polygon ring approximation (48 vertices, closed). */
export function circleToPolygonRing(
  centerLat: number,
  centerLng: number,
  radiusM: number,
  vertices = 48,
): number[][] {
  const ring: number[][] = [];
  const latRad = (centerLat * Math.PI) / 180;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos(latRad);
  for (let i = 0; i <= vertices; i++) {
    const theta = (2 * Math.PI * i) / vertices;
    const dLat = (radiusM * Math.sin(theta)) / metersPerDegLat;
    const dLng = (radiusM * Math.cos(theta)) / metersPerDegLng;
    ring.push([centerLng + dLng, centerLat + dLat]);
  }
  return ring;
}

export function GeofenceDrawMap({
  geofences,
  mode,
  circleRadiusM,
  onDrawn,
  height = 360,
}: GeofenceDrawMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const [polygonVertices, setPolygonVertices] = useState<number[][]>([]);
  const [circleCenter, setCircleCenter] = useState<[number, number] | null>(null);
  const modeRef = useRef(mode);
  const radiusRef = useRef(circleRadiusM);
  modeRef.current = mode;
  radiusRef.current = circleRadiusM;

  // Emit the drawn geometry upward whenever it changes.
  useEffect(() => {
    if (mode === 'polygon') {
      if (polygonVertices.length < 3) {
        onDrawn(null);
        return;
      }
      const ring = [...polygonVertices, polygonVertices[0]];
      onDrawn({ boundary: { type: 'Polygon', coordinates: [ring] } });
      return;
    }
    if (mode === 'circle' && circleCenter) {
      const [lat, lng] = circleCenter;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || circleRadiusM < 10) {
        onDrawn(null);
        return;
      }
      onDrawn({
        boundary: { type: 'Polygon', coordinates: [circleToPolygonRing(lat, lng, circleRadiusM)] },
        centerLat: lat,
        centerLng: lng,
        radiusM: circleRadiusM,
      });
      return;
    }
    onDrawn(null);
  }, [mode, polygonVertices, circleCenter, circleRadiusM, onDrawn]);

  // Reset drawing state on mode switch.
  useEffect(() => {
    setPolygonVertices([]);
    setCircleCenter(null);
  }, [mode]);

  // Initialize the map once.
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
      map.addSource('geofence-draw', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'geofence-draw-fill',
        type: 'fill',
        source: 'geofence-draw',
        paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.15 },
      });
      map.addLayer({
        id: 'geofence-draw-line',
        type: 'line',
        source: 'geofence-draw',
        paint: { 'line-color': '#2563eb', 'line-width': 2 },
      });
    });
    map.on('click', (e) => {
      const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      if (modeRef.current === 'polygon') {
        setPolygonVertices((prev) => {
          if (lngLat[1] < -90 || lngLat[1] > 90 || lngLat[0] < -180 || lngLat[0] > 180) {
            return prev;
          }
          return [...prev, lngLat];
        });
      } else if (modeRef.current === 'circle') {
        setCircleCenter(lngLat);
      }
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Redraw the preview (vertices/radius live).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const redraw = () => {
      const src = map.getSource('geofence-draw') as GeoJSONSource | undefined;
      if (!src) return;
      if (mode === 'polygon' && polygonVertices.length > 0) {
        const ring =
          polygonVertices.length >= 3
            ? [...polygonVertices, polygonVertices[0]]
            : polygonVertices;
        src.setData({
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', geometry: { type: 'LineString', coordinates: ring }, properties: {} },
          ],
        });
      } else if (mode === 'circle' && circleCenter) {
        src.setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [circleToPolygonRing(circleCenter[0], circleCenter[1], circleRadiusM)],
              },
              properties: {},
            },
          ],
        });
      } else {
        src.setData({ type: 'FeatureCollection', features: [] });
      }
    };
    if (map.isStyleLoaded()) redraw();
    else map.once('load', redraw);
  }, [mode, polygonVertices, circleCenter, circleRadiusM]);

  // Render existing geofences as static outlines.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const render = () => {
      const src = map.getSource('geofence-existing') as GeoJSONSource | undefined;
      if (!src) {
        map.addSource('geofence-existing', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'geofence-existing-fill',
          type: 'fill',
          source: 'geofence-existing',
          paint: { 'fill-color': '#16a34a', 'fill-opacity': 0.08 },
        });
        map.addLayer({
          id: 'geofence-existing-line',
          type: 'line',
          source: 'geofence-existing',
          paint: { 'line-color': '#16a34a', 'line-width': 1.5 },
        });
      }
      const features: GeoJSON.Feature[] = [];
      for (const g of geofences) {
        if (g.boundaryGeoJson) {
          features.push({
            type: 'Feature',
            geometry: g.boundaryGeoJson as GeoJSON.Polygon,
            properties: { name: g.name },
          });
        } else if (g.centerLat !== null && g.centerLng !== null && g.radiusM) {
          features.push({
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [circleToPolygonRing(g.centerLat, g.centerLng, g.radiusM)],
            },
            properties: { name: g.name },
          });
        }
      }
      (map.getSource('geofence-existing') as GeoJSONSource).setData({
        type: 'FeatureCollection',
        features,
      });
    };
    if (map.isStyleLoaded()) render();
    else map.once('load', render);
  }, [geofences]);

  const hint =
    mode === 'polygon'
      ? `Click to add vertices (${polygonVertices.length}/3 min.)`
      : mode === 'circle'
        ? circleCenter
          ? `Center set — adjust the radius in the form`
          : 'Click the map to set the circle center'
        : 'Select a geometry type to draw';

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height, borderRadius: 8, overflow: 'hidden' }}
        data-testid="geofence-draw-map"
      />
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          background: 'rgba(255,255,255,0.92)',
          padding: '2px 8px',
          borderRadius: 6,
          fontSize: 12,
          color: '#334155',
          pointerEvents: 'none',
        }}
      >
        {hint}
      </div>
      {mode === 'polygon' && polygonVertices.length > 0 && (
        <button
          type="button"
          onClick={() => setPolygonVertices([])}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            background: 'rgba(255,255,255,0.92)',
            border: 'none',
            borderRadius: 6,
            padding: '2px 8px',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}
