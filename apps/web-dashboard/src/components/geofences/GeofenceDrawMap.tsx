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
 *     - click once to set the center — the circle uses the radius field
 *       immediately (the map fits the ring so it is not a 4-pixel “dot”);
 *     - drag the edge handle to resize, or type the radius (bidirectional).
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { runWhenStyleReady } from '@/lib/map-ready';
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
  const metersPerDegLng = Math.max(111_320 * Math.cos(latRad), 1e-6);
  const r = Math.max(0, radiusM);
  for (let i = 0; i <= vertices; i++) {
    const theta = (2 * Math.PI * i) / vertices;
    const dLat = (r * Math.sin(theta)) / metersPerDegLat;
    const dLng = (r * Math.cos(theta)) / metersPerDegLng;
    ring.push([centerLng + dLng, centerLat + dLat]);
  }
  return ring;
}

/** Eastern-edge handle used to drag-resize a circle. MapLibre wants [lng, lat]. */
export function radiusHandleLngLat(
  centerLat: number,
  centerLng: number,
  radiusM: number,
): [number, number] {
  const latRad = (centerLat * Math.PI) / 180;
  const metersPerDegLng = Math.max(111_320 * Math.cos(latRad), 1e-6);
  return [centerLng + Math.max(10, radiusM) / metersPerDegLng, centerLat];
}

function circleBounds(
  lat: number,
  lng: number,
  radiusM: number,
): [[number, number], [number, number]] {
  const ring = circleToPolygonRing(lat, lng, Math.max(10, radiusM));
  const lngs = ring.map((p) => p[0] ?? lng);
  const lats = ring.map((p) => p[1] ?? lat);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

function fitCircle(map: MaplibreMap, lat: number, lng: number, radiusM: number): void {
  const bounds = circleBounds(lat, lng, radiusM);
  const apply = (attempt: number) => {
    map.resize();
    const w = map.getContainer().clientWidth;
    const h = map.getContainer().clientHeight;
    if ((w < 32 || h < 32) && attempt < 24) {
      requestAnimationFrame(() => apply(attempt + 1));
      return;
    }
    // Instant camera — animated fitBounds was cancelled by modal ResizeObserver.
    map.stop();
    map.fitBounds(bounds, { padding: 56, maxZoom: 16, duration: 0 });
  };
  requestAnimationFrame(() => apply(0));
}

/**
 * Zoom so a circle of `radiusM` fills ~55% of the shorter viewport side.
 * At zoom 10 a 500 m ring is ~4 px — indistinguishable from a marker.
 */
export function zoomForCircleRadius(radiusM: number, latitude: number, viewportPx = 320): number {
  const r = Math.max(10, radiusM);
  const metersPerPixelWanted = (2 * r) / Math.max(viewportPx * 0.55, 80);
  const cosLat = Math.max(Math.cos((latitude * Math.PI) / 180), 0.01);
  const z = Math.log2((156_543.03392 * cosLat) / metersPerPixelWanted);
  return Math.min(17, Math.max(8, z));
}

/** Drop a closing vertex that duplicates the first (GeoJSON rings). */
export function dropRingClosure(ring: number[][]): number[][] {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && first[0] === last[0] && first[1] === last[1]) {
    return ring.slice(0, -1);
  }
  return ring;
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function pointOnSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): boolean {
  const eps = 1e-12;
  if (Math.abs(orient(ax, ay, bx, by, px, py)) > eps) return false;
  return (
    px >= Math.min(ax, bx) - eps &&
    px <= Math.max(ax, bx) + eps &&
    py >= Math.min(ay, by) - eps &&
    py <= Math.max(ay, by) + eps
  );
}

/** True when ab and cd cross in their interiors (or overlap), not merely share an endpoint. */
function segmentsCross(a: number[], b: number[], c: number[], d: number[]): boolean {
  const ax = a[0] ?? 0;
  const ay = a[1] ?? 0;
  const bx = b[0] ?? 0;
  const by = b[1] ?? 0;
  const cx = c[0] ?? 0;
  const cy = c[1] ?? 0;
  const dx = d[0] ?? 0;
  const dy = d[1] ?? 0;
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  const s1 = Math.sign(o1);
  const s2 = Math.sign(o2);
  const s3 = Math.sign(o3);
  const s4 = Math.sign(o4);
  if (s1 !== 0 && s2 !== 0 && s3 !== 0 && s4 !== 0 && s1 !== s2 && s3 !== s4) return true;
  if (s1 === 0 && s2 === 0 && s3 === 0 && s4 === 0) {
    const overlapX = Math.min(ax, bx) <= Math.max(cx, dx) && Math.min(cx, dx) <= Math.max(ax, bx);
    const overlapY = Math.min(ay, by) <= Math.max(cy, dy) && Math.min(cy, dy) <= Math.max(ay, by);
    const shareOnlyEnd =
      (ax === cx && ay === cy) ||
      (ax === dx && ay === dy) ||
      (bx === cx && by === cy) ||
      (bx === dx && by === dy);
    return overlapX && overlapY && !shareOnlyEnd;
  }
  if (
    s1 === 0 &&
    pointOnSegment(ax, ay, bx, by, cx, cy) &&
    !(cx === ax && cy === ay) &&
    !(cx === bx && cy === by)
  )
    return true;
  if (
    s2 === 0 &&
    pointOnSegment(ax, ay, bx, by, dx, dy) &&
    !(dx === ax && dy === ay) &&
    !(dx === bx && dy === by)
  )
    return true;
  if (
    s3 === 0 &&
    pointOnSegment(cx, cy, dx, dy, ax, ay) &&
    !(ax === cx && ay === cy) &&
    !(ax === dx && ay === dy)
  )
    return true;
  if (
    s4 === 0 &&
    pointOnSegment(cx, cy, dx, dy, bx, by) &&
    !(bx === cx && by === cy) &&
    !(bx === dx && by === dy)
  )
    return true;
  return false;
}

/**
 * True when a polygon ring folds over itself (bow-tie). PostGIS ST_IsValid
 * rejects these; catching them here lets the UI paint the area red and block save.
 */
export function ringSelfIntersects(ring: number[][]): boolean {
  const pts = dropRingClosure(ring);
  const n = pts.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (!a || !b) continue;
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      const c = pts[j];
      const d = pts[(j + 1) % n];
      if (!c || !d) continue;
      if (segmentsCross(a, b, c, d)) return true;
    }
  }
  return false;
}

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
  height = 480,
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
  const setDragging = useCallback((v: boolean) => {
    draggingRadiusRef.current = v;
    setDraggingRadius(v);
  }, []);
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
      if (ringSelfIntersects(polygonVertices)) {
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
      const radiusM = Math.max(10, circleRadiusM);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        onDrawn(null);
        return;
      }
      onDrawn({
        boundary: { type: 'Polygon', coordinates: [circleToPolygonRing(lat, lng, radiusM)] },
        centerLat: lat,
        centerLng: lng,
        radiusM,
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

    const container = containerRef.current;
    let lastW = 0;
    let lastH = 0;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      if (Math.abs(cr.width - lastW) < 1 && Math.abs(cr.height - lastH) < 1) return;
      lastW = cr.width;
      lastH = cr.height;
      map.resize();
      const center = centerRef.current;
      if (center && modeRef.current === 'circle' && !draggingRadiusRef.current) {
        fitCircle(map, center[0], center[1], Math.max(10, radiusRef.current));
      }
    });
    ro.observe(container);

    map.on('load', () => {
      map.resize();
      map.addSource('geofence-draw', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'geofence-draw-fill',
        type: 'fill',
        source: 'geofence-draw',
        paint: {
          'fill-color': ['case', ['boolean', ['get', 'invalid'], false], '#dc2626', '#2563eb'],
          'fill-opacity': 0.38,
        },
      });
      map.addLayer({
        id: 'geofence-draw-line',
        type: 'line',
        source: 'geofence-draw',
        paint: {
          'line-color': ['case', ['boolean', ['get', 'invalid'], false], '#dc2626', '#2563eb'],
          'line-width': 3,
        },
      });
      map.addSource('geofence-existing', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'geofence-existing-fill',
        type: 'fill',
        source: 'geofence-existing',
        paint: { 'fill-color': '#16a34a', 'fill-opacity': 0.14 },
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
      } else if (
        initial?.type === 'CIRCLE' &&
        initial.centerLat !== undefined &&
        initial.centerLng !== undefined &&
        initial.radiusM
      ) {
        fitCircle(map, initial.centerLat, initial.centerLng, initial.radiusM);
      }
    });

    // ── Click: add polygon vertex / set circle center (circle uses the form radius).
    map.on('click', (e) => {
      if (drawingRef.current) {
        drawingRef.current = false;
        return;
      }
      const lat = e.lngLat.lat;
      const lng = e.lngLat.lng;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
      if (modeRef.current === 'polygon') {
        setPolygonVertices((prev) => {
          if (prev.length > 0) {
            const last = prev[prev.length - 1];
            if (last && haversineMeters(last[1] ?? 0, last[0] ?? 0, lat, lng) < 3) {
              return prev;
            }
          }
          if (prev.length >= 3) {
            const first = prev[0];
            if (first) {
              const a = map.project([first[0] ?? 0, first[1] ?? 0]);
              const b = map.project([lng, lat]);
              if (Math.hypot(a.x - b.x, a.y - b.y) < 16) return prev;
            }
          }
          return [...prev, [lng, lat]];
        });
      } else if (modeRef.current === 'circle') {
        setCircleCenter([lat, lng]);
        centerRef.current = [lat, lng];
        fitCircle(map, lat, lng, Math.max(10, radiusRef.current));
      }
    });

    map.getCanvas().addEventListener('contextmenu', (e) => e.preventDefault());
    return () => {
      ro.disconnect();
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
        runWhenStyleReady(map, sync);
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

  // ── Circle center + radius-edge handle (draggable) ──
  const centerMarkerRef = useRef<Marker | null>(null);
  const radiusHandleRef = useRef<Marker | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sync = () => {
      if (!map.isStyleLoaded() && !map.getSource('geofence-draw')) {
        runWhenStyleReady(map, sync);
        return;
      }
      centerMarkerRef.current?.remove();
      centerMarkerRef.current = null;
      radiusHandleRef.current?.remove();
      radiusHandleRef.current = null;
      if (mode !== 'circle' || !circleCenter) return;
      const radiusM = Math.max(10, radiusRef.current);

      const centerEl = document.createElement('div');
      centerEl.style.width = '12px';
      centerEl.style.height = '12px';
      centerEl.style.borderRadius = '50%';
      centerEl.style.background = '#dc2626';
      centerEl.style.border = '2px solid #fff';
      centerEl.style.cursor = 'grab';
      centerEl.style.boxShadow = '0 0 0 1px rgb(0 0 0 / 0.25)';
      centerEl.title = t('geofences.draw.centerHint', {
        defaultValue: 'Circle center — drag to move',
      });
      const centerMarker = new Marker({ element: centerEl, anchor: 'center' })
        .setLngLat([circleCenter[1], circleCenter[0]])
        .setDraggable(true)
        .addTo(map);
      centerMarker.on('dragend', () => {
        const ll = centerMarker.getLngLat();
        drawingRef.current = true;
        setCircleCenter([ll.lat, ll.lng]);
      });
      centerMarkerRef.current = centerMarker;

      const handleEl = document.createElement('div');
      handleEl.style.width = '16px';
      handleEl.style.height = '16px';
      handleEl.style.borderRadius = '50%';
      handleEl.style.background = '#2563eb';
      handleEl.style.border = '2px solid #fff';
      handleEl.style.cursor = 'ew-resize';
      handleEl.style.boxShadow = '0 0 0 1px rgb(0 0 0 / 0.25)';
      handleEl.title = t('geofences.draw.radiusHandleHint', {
        defaultValue: 'Drag to change the radius',
      });
      const handle = new Marker({ element: handleEl, anchor: 'center' })
        .setLngLat(radiusHandleLngLat(circleCenter[0], circleCenter[1], radiusM))
        .setDraggable(true)
        .addTo(map);
      handle.on('dragstart', () => {
        map.dragPan.disable();
        setDragging(true);
      });
      handle.on('drag', () => {
        const center = centerRef.current;
        if (!center) return;
        const ll = handle.getLngLat();
        const r = haversineMeters(center[0], center[1], ll.lat, ll.lng);
        onRadiusChangeRef.current?.(Math.max(10, Math.min(500_000, Math.round(r))));
      });
      handle.on('dragend', () => {
        drawingRef.current = true;
        map.dragPan.enable();
        setDragging(false);
      });
      radiusHandleRef.current = handle;
    };
    sync();
    return () => {
      centerMarkerRef.current?.remove();
      centerMarkerRef.current = null;
      radiusHandleRef.current?.remove();
      radiusHandleRef.current = null;
    };
    // Recreate markers when the center moves; radius updates move the handle below.
  }, [mode, circleCenter, t, setDragging]);

  // Keep the edge handle on the current radius without tearing down the marker.
  useEffect(() => {
    if (draggingRadius || !circleCenter) return;
    radiusHandleRef.current?.setLngLat(
      radiusHandleLngLat(circleCenter[0], circleCenter[1], Math.max(10, circleRadiusM)),
    );
  }, [circleCenter, circleRadiusM, draggingRadius]);

  // Zoom so the ring is visible (zoom 10 makes a 500 m circle ~4 px — a “dot”).
  useEffect(() => {
    if (mode !== 'circle' || !circleCenter || draggingRadius) return;
    const map = mapRef.current;
    if (!map) return;
    const radiusM = Math.max(10, circleRadiusM);
    const [lat, lng] = circleCenter;
    const timer = window.setTimeout(() => {
      fitCircle(map, lat, lng, radiusM);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [mode, circleCenter, circleRadiusM, draggingRadius]);

  // Redraw the preview (vertices/radius live). Gate on the source existing —
  // `isStyleLoaded()` stays false while tiles stream after fitBounds, which
  // used to skip setData and leave an empty source (markers only, no ring).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const redraw = () => {
      const src = map.getSource('geofence-draw') as GeoJSONSource | undefined;
      if (!src) {
        runWhenStyleReady(map, () => {
          if (map.getSource('geofence-draw')) redraw();
        });
        return;
      }
      if (mode === 'polygon' && polygonVertices.length > 0) {
        const invalid = ringSelfIntersects(polygonVertices);
        if (polygonVertices.length >= 3) {
          const first = polygonVertices[0] as number[];
          src.setData({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'Polygon',
                  coordinates: [[...polygonVertices, first]],
                },
                properties: { invalid },
              },
            ],
          });
        } else {
          src.setData({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: polygonVertices },
                properties: { invalid: false },
              },
            ],
          });
        }
      } else if (mode === 'circle' && circleCenter) {
        const radiusM = Math.max(10, circleRadiusM);
        src.setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [circleToPolygonRing(circleCenter[0], circleCenter[1], radiusM)],
              },
              properties: {},
            },
          ],
        });
      } else {
        src.setData({ type: 'FeatureCollection', features: [] });
      }
    };
    redraw();
  }, [mode, polygonVertices, circleCenter, circleRadiusM]);

  // Render existing geofences as static outlines.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const render = () => {
      const src = map.getSource('geofence-existing') as GeoJSONSource | undefined;
      if (!src) {
        runWhenStyleReady(map, () => {
          if (map.getSource('geofence-existing')) render();
        });
        return;
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
      src.setData({ type: 'FeatureCollection', features });
    };
    render();
  }, [geofences]);

  const areaM2 = useMemo(
    () =>
      mode === 'polygon' && polygonVertices.length >= 3
        ? polygonAreaM2([...polygonVertices, polygonVertices[0] as number[]])
        : 0,
    [mode, polygonVertices],
  );

  const polygonInvalid = mode === 'polygon' && ringSelfIntersects(polygonVertices);

  const statusText =
    mode === 'polygon'
      ? polygonInvalid
        ? t('geofences.draw.selfIntersecting', {
            defaultValue: 'Edges cross — drag a vertex so the blue fill does not fold over itself.',
          })
        : polygonVertices.length === 0
          ? t('geofences.draw.polygonHint', {
              defaultValue: 'Click the map to add vertices. The blue fill is the selected area.',
            })
          : t('geofences.draw.polygonStatus', {
              count: polygonVertices.length,
              area:
                areaM2 >= 10_000
                  ? `${(areaM2 / 10_000).toFixed(1)} ha`
                  : `${Math.round(areaM2)} m²`,
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
                radius: Math.round(Math.max(10, circleRadiusM)),
                defaultValue: `Center ${circleCenter[0].toFixed(5)}, ${circleCenter[1].toFixed(5)} · radius ${Math.round(Math.max(10, circleRadiusM))} m`,
              })
          : t('geofences.draw.circleCenterHint', {
              defaultValue: 'Click the map to place the center. The circle uses the radius field.',
            })
        : t('geofences.draw.selectType', { defaultValue: 'Select a geometry type to draw' });

  // TailAdmin map-overlay button (token-owned classes — Phase 2.6 §10).
  const btnClassName =
    'cursor-pointer rounded-md border border-gray-300 bg-white/95 px-2.5 py-0.5 text-xs text-gray-900 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30';

  return (
    <div>
      {/* Non-map, screen-reader-visible status (Sprint I §51). */}
      <p
        aria-live="polite"
        className={`my-1 mx-0.5 text-xs ${
          polygonInvalid
            ? 'text-danger-600 dark:text-danger-400'
            : 'text-gray-600 dark:text-graydark-600'
        }`}
      >
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
