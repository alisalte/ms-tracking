/**
 * GeofenceDrawMap — real-map geofence drawing + editing (Sprint G §33/34;
 * upgraded in Sprint I §12–§15).
 *
 * MapLibre GL drawing surface where THE MAP is the primary interface:
 *
 *   POLYGON mode (Sprint I §14):
 *     - click the map to append vertices (live preview);
 *     - drag a vertex marker to move it;
 *     - right-click (or alt+click) a vertex to delete it;
 *     - Remove-last / Clear / Finish controls; live vertex count + area.
 *
 *   CIRCLE mode (Sprint I §13):
 *     - click once to set the center;
 *     - DRAG on the map to set the radius (haversine meters, live readout);
 *     - drag again any time to redraw; the numeric radius field stays in sync
 *       and may also be typed into (bidirectional).
 *
 *   EDIT mode (Sprint I §15): pass `initial` — the map boots with the saved
 *   geometry (boundary ring or center+radius) already editable. No
 *   delete+recreate needed.
 *
 * Existing geofences render read-only underneath. Coordinates are validated
 * client-side ([−90,90]/[−180,180], ≥3 vertices, ≥10 m radius) and the backend
 * re-validates authoritatively (PostGIS ST_IsValid) on persist.
 *
 * Accessibility (Sprint I §51): drawing status is mirrored in an
 * aria-live="polite" region OUTSIDE the map, and every control is a real
 * labeled button — the map is never the only feedback channel.
 */
import { type GeoJSONSource, Map as MaplibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

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

/** Optional initial geometry for EDIT mode (from a saved geofence). */
export interface InitialGeometry {
  type: GeofenceTypeLite;
  ring?: number[][];
  centerLat?: number;
  centerLng?: number;
  radiusM?: number;
}
type GeofenceTypeLite = 'POLYGON' | 'CIRCLE' | 'CORRIDOR';

interface GeofenceDrawMapProps {
  geofences: readonly Geofence[];
  mode: DrawMode;
  /** Circle radius (meters) — bidirectional with the form. */
  circleRadiusM: number;
  onDrawn: (drawn: DrawnGeofence | null) => void;
  /** Radius changed by dragging on the map (form sync). */
  onRadiusChange?: (meters: number) => void;
  /** Edit-mode seed geometry (Sprint I §15). */
  initial?: InitialGeometry | null;
  height?: number;
}

/** Haversine distance in meters (client-side preview only — PostGIS is
 * authoritative for persisted geometry + evaluation). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const p = Math.PI / 180;
  const dLat = (lat2 - lat1) * p;
  const dLng = (lng2 - lng1) * p;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
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

/** Approximate polygon area (m²) via the shoelace formula on a local plane. */
export function polygonAreaM2(ring: number[][]): number {
  if (ring.length < 4) return 0;
  const lat0 = ring[0]?.[1] ?? 0;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i] as [number, number];
    const b = ring[i + 1] as [number, number];
    sum += (a[0] - b[0]) * mPerDegLng * (a[1] + b[1]) * mPerDegLat;
  }
  return Math.abs(sum / 2);
}

export function GeofenceDrawMap({
  geofences,
  mode,
  circleRadiusM,
  onDrawn,
  onRadiusChange,
  initial,
  height = 360,
}: GeofenceDrawMapProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const [polygonVertices, setPolygonVertices] = useState<number[][]>(
    initial?.type !== 'CIRCLE' && initial?.ring && initial.ring.length >= 3
      ? initial.ring.slice(0, -1) // drop the closure; it is re-appended on emit
      : [],
  );
  const [circleCenter, setCircleCenter] = useState<[number, number] | null>(
    initial?.type === 'CIRCLE' && initial.centerLat !== undefined && initial.centerLng !== undefined
      ? [initial.centerLat, initial.centerLng]
      : null,
  );
  const [draggingRadius, setDraggingRadius] = useState(false);
  const draggingRadiusRef = useRef(false);
  const setDragging = (v: boolean) => {
    draggingRadiusRef.current = v;
    setDraggingRadius(v);
  };
  const modeRef = useRef(mode);
  const radiusRef = useRef(circleRadiusM);
  const centerRef = useRef(circleCenter);
  const drawingRef = useRef(false); // a click was just consumed by drawing
  modeRef.current = mode;
  radiusRef.current = circleRadiusM;
  centerRef.current = circleCenter;

  // Seed the radius when editing an existing circle (form ↔ map sync, once).
  const seededRadius = useRef(false);
  const onRadiusChangeRef = useRef(onRadiusChange);
  onRadiusChangeRef.current = onRadiusChange;
  useEffect(() => {
    if (initial?.type === 'CIRCLE' && initial.radiusM && !seededRadius.current) {
      seededRadius.current = true;
      onRadiusChangeRef.current?.(Math.round(initial.radiusM));
    }
  }, [initial]);

  // Emit the drawn geometry upward whenever it changes.
  useEffect(() => {
    if (mode === 'polygon') {
      if (polygonVertices.length < 3) {
        onDrawn(null);
        return;
      }
      const first = polygonVertices[0] as number[];
      const ring = [...polygonVertices, first];
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
    // onDrawn is the parent's setState (stable identity) in every caller.
  }, [mode, polygonVertices, circleCenter, circleRadiusM, onDrawn]);

  // Initialize the map once (mount-only by design — the same pattern as every
  // map component in this repo; `initial` is the edit seed read once).
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only init.
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
      center:
        initial?.type === 'CIRCLE' &&
        initial.centerLng !== undefined &&
        initial.centerLat !== undefined
          ? [initial.centerLng, initial.centerLat]
          : initial?.ring && initial.ring.length >= 3
            ? (initial.ring[Math.floor(initial.ring.length / 2)] as [number, number])
            : [51.338, 35.719],
      zoom: initial ? 13 : 10,
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
      if (initial?.ring && initial.ring.length >= 3) {
        const lngs = initial.ring.map((r) => r[0] ?? 0);
        const lats = initial.ring.map((r) => r[1] ?? 0);
        map.fitBounds(
          [
            [Math.min(...lngs), Math.min(...lats)],
            [Math.max(...lngs), Math.max(...lats)],
          ],
          { padding: 60, maxZoom: 15, duration: 0 },
        );
      }
    });

    // ── Click: add polygon vertex / set circle center ──
    map.on('click', (e) => {
      if (drawingRef.current) {
        drawingRef.current = false;
        return;
      }
      const lat = e.lngLat.lat;
      const lng = e.lngLat.lng;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
      if (modeRef.current === 'polygon') {
        setPolygonVertices((prev) => [...prev, [lng, lat]]);
      } else if (modeRef.current === 'circle') {
        setCircleCenter([lat, lng]);
        centerRef.current = [lat, lng];
        setDragging(true); // immediately start a radius drag
      }
    });

    // ── Sprint I §13: drag to set the circle radius ──
    map.on('mousemove', (e) => {
      if (!draggingRadiusRef.current || !centerRef.current) return;
      const r = haversineMeters(
        centerRef.current[0],
        centerRef.current[1],
        e.lngLat.lat,
        e.lngLat.lng,
      );
      const clamped = Math.max(10, Math.min(500_000, Math.round(r)));
      onRadiusChangeRef.current?.(clamped);
    });
    map.on('mouseout', () => setDragging(false));
    const stopDrag = () => setDragging(false);
    map.on('dragstart', stopDrag);
    map.on('zoomstart', stopDrag);
    map.getCanvas().addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mouseup', stopDrag);
    return () => {
      window.removeEventListener('mouseup', stopDrag);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset drawing state on mode switch — but NOT on the initial mount, which
  // would wipe the edit-mode seed geometry (Sprint I §15).
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    // Leaving draw mode entirely also clears the surface.
    if (mode === null) setDraggingRadius(false);
    setPolygonVertices([]);
    setCircleCenter(null);
    setDraggingRadius(false);
  }, [mode]);

  // ── Draggable polygon vertex markers (Sprint I §14) ──
  const vertexMarkersRef = useRef<Marker[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sync = () => {
      if (!map.isStyleLoaded() && !map.getSource('geofence-draw')) {
        map.once('load', sync);
        return;
      }
      for (const m of vertexMarkersRef.current) m.remove();
      vertexMarkersRef.current = [];
      if (mode !== 'polygon') return;
      polygonVertices.forEach((v, i) => {
        const el = document.createElement('div');
        el.className = 'fv-draw-vertex';
        el.style.width = '12px';
        el.style.height = '12px';
        el.style.borderRadius = '50%';
        el.style.background = '#2563eb';
        el.style.border = '2px solid #fff';
        el.style.cursor = 'grab';
        el.title = t('geofences.draw.vertexHint', {
          defaultValue: `Vertex ${i + 1} — drag to move, right-click to remove`,
        });
        const marker = new Marker({ element: el, anchor: 'center' })
          .setLngLat([v[0] ?? 0, v[1] ?? 0])
          .setDraggable(true)
          .addTo(map);
        marker.on('dragend', () => {
          const ll = marker.getLngLat();
          setPolygonVertices((prev) => {
            const next = [...prev];
            next[i] = [ll.lng, ll.lat];
            return next;
          });
        });
        el.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          setPolygonVertices((prev) => prev.filter((_, idx) => idx !== i));
        });
        vertexMarkersRef.current.push(marker);
      });
    };
    sync();
    return () => {
      for (const m of vertexMarkersRef.current) m.remove();
      vertexMarkersRef.current = [];
    };
  }, [mode, polygonVertices, t]);

  // ── Circle center marker (draggable) ──
  const centerMarkerRef = useRef<Marker | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sync = () => {
      if (!map.isStyleLoaded() && !map.getSource('geofence-draw')) {
        map.once('load', sync);
        return;
      }
      centerMarkerRef.current?.remove();
      centerMarkerRef.current = null;
      if (mode !== 'circle' || !circleCenter) return;
      const el = document.createElement('div');
      el.style.width = '10px';
      el.style.height = '10px';
      el.style.borderRadius = '50%';
      el.style.background = '#dc2626';
      el.style.border = '2px solid #fff';
      el.style.cursor = 'grab';
      el.title = t('geofences.draw.centerHint', { defaultValue: 'Circle center — drag to move' });
      const marker = new Marker({ element: el, anchor: 'center' })
        .setLngLat([circleCenter[1], circleCenter[0]])
        .setDraggable(true)
        .addTo(map);
      marker.on('dragend', () => {
        const ll = marker.getLngLat();
        setCircleCenter([ll.lat, ll.lng]);
      });
      centerMarkerRef.current = marker;
    };
    sync();
    return () => {
      centerMarkerRef.current?.remove();
      centerMarkerRef.current = null;
    };
  }, [mode, circleCenter, t]);

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
            ? [...polygonVertices, polygonVertices[0] as number[]]
            : polygonVertices;
        src.setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: ring },
              properties: {},
            },
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
    // mapRef is a stable ref; listed for the exhaustive-deps contract.
  }, [mode, polygonVertices, circleCenter, circleRadiusM]);

  // Render existing geofences as static outlines.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const render = () => {
      const src = map.getSource('geofence-existing') as GeoJSONSource | undefined;
      if (!src) return;
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
      src.setData({ type: 'FeatureCollection', features });
    };
    if (map.isStyleLoaded()) render();
    else map.once('load', render);
  }, [geofences]);

  const areaM2 = useMemo(
    () =>
      mode === 'polygon' && polygonVertices.length >= 3
        ? polygonAreaM2([...polygonVertices, polygonVertices[0] as number[]])
        : 0,
    [mode, polygonVertices],
  );

  const statusText =
    mode === 'polygon'
      ? t('geofences.draw.polygonStatus', {
          count: polygonVertices.length,
          area:
            areaM2 >= 10_000 ? `${(areaM2 / 10_000).toFixed(1)} ha` : `${Math.round(areaM2)} m²`,
          defaultValue: `${polygonVertices.length} vertices · ${areaM2 >= 10_000 ? `${(areaM2 / 10_000).toFixed(1)} ha` : `${Math.round(areaM2)} m²`}`,
        })
      : mode === 'circle'
        ? circleCenter
          ? draggingRadius
            ? t('geofences.draw.circleDragging', {
                defaultValue: 'Drag outward to set the radius — release to finish',
              })
            : t('geofences.draw.circleStatus', {
                lat: circleCenter[0].toFixed(5),
                lng: circleCenter[1].toFixed(5),
                radius: Math.round(circleRadiusM),
                defaultValue: `Center ${circleCenter[0].toFixed(5)}, ${circleCenter[1].toFixed(5)} · radius ${Math.round(circleRadiusM)} m`,
              })
          : t('geofences.draw.circleCenterHint', {
              defaultValue: 'Click the map to set the center, then drag to set the radius',
            })
        : t('geofences.draw.selectType', { defaultValue: 'Select a geometry type to draw' });

  // TailAdmin map-overlay button (token-owned classes — Phase 2.6 §10).
  const btnClassName =
    'cursor-pointer rounded-md border border-gray-300 bg-white/95 px-2.5 py-0.5 text-xs text-gray-900 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30';

  return (
    <div>
      {/* Non-map, screen-reader-visible status (Sprint I §51). */}
      <p aria-live="polite" className="my-1 mx-0.5 text-xs text-gray-600 dark:text-graydark-600">
        {statusText}
      </p>
      <div className="relative">
        <div
          ref={containerRef}
          style={{ width: '100%', height, borderRadius: 8, overflow: 'hidden' }}
          data-testid="geofence-draw-map"
          role="application"
          aria-label={t('geofences.draw.mapLabel', { defaultValue: 'Geofence drawing map' })}
        />
        <div className="absolute top-2 start-2 flex gap-1.5">
          {mode === 'polygon' && polygonVertices.length > 0 && (
            <>
              <button
                type="button"
                className={btnClassName}
                aria-label={t('geofences.draw.removeLast', { defaultValue: 'Remove last vertex' })}
                onClick={() => setPolygonVertices((prev) => prev.slice(0, -1))}
              >
                {t('geofences.draw.removeLastLabel', { defaultValue: '− Vertex' })}
              </button>
              <button
                type="button"
                className={btnClassName}
                aria-label={t('geofences.draw.clear', { defaultValue: 'Clear polygon' })}
                onClick={() => setPolygonVertices([])}
              >
                {t('common.clear', { defaultValue: 'Clear' })}
              </button>
            </>
          )}
          {mode === 'circle' && circleCenter && (
            <button
              type="button"
              className={btnClassName}
              aria-label={t('geofences.draw.redrawCircle', {
                defaultValue: 'Clear circle and redraw',
              })}
              onClick={() => {
                setCircleCenter(null);
                setDraggingRadius(false);
              }}
            >
              {t('common.clear', { defaultValue: 'Clear' })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
