/**
 * AnalyticsMap — the shared MapLibre canvas of the spatial analytics page.
 *
 * Raster basemaps are opaque and a grid square is often smaller than a pixel,
 * so the legend colors (coverage levels, activity, project outline, stops)
 * are painted in an SVG overlay above the tiles. GeoJSON layers stay for
 * hit-testing. `fitKey` re-frames on the cells themselves; an animated
 * fitBounds was getting cancelled by the resize observer and left the camera
 * on the default city.
 */
import { Map as MaplibreGL, Popup } from 'maplibre-gl';
import type { GeoJSONSource, MapLayerMouseEvent, Map as MaplibreMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { MapSettingsPanel } from '@/components/map/MapSettingsPanel';
import { useFollowBasemap } from '@/hooks/useBasemap';
import {
  type CellSample,
  type HeatSample,
  type LngLat,
  type PointSample,
  analyticsViewBounds,
  projectAnalyticsOverlay,
} from '@/lib/analytics-map-geo';
import { loadPersistedBasemap, rasterMapStyle } from '@/lib/basemaps';
import { runWhenStyleReady } from '@/lib/map-ready';

export interface MapCell {
  south: number;
  west: number;
  north: number;
  east: number;
  color: string;
  /** 0..1 fill opacity. */
  opacity?: number;
  /** Plain text tooltip (newline-separated lines). */
  tip?: string;
}

export interface MapPoint {
  lat: number;
  lng: number;
  color: string;
  /** Marks a ranked point (drawn larger); the rank itself is shown in the list. */
  label?: string;
  tip?: string;
}

export interface MapHeatPoint {
  lat: number;
  lng: number;
  weight: number;
}

interface AnalyticsMapProps {
  cells?: readonly MapCell[];
  heat?: readonly MapHeatPoint[];
  hull?: ReadonlyArray<{ lat: number; lng: number }>;
  points?: readonly MapPoint[];
  /** Change to re-frame the map on the current data. */
  fitKey?: string;
  /** Imperative fly-to target (lat/lng + nonce so the same spot can repeat). */
  focus?: { lat: number; lng: number; nonce: number } | null;
  className?: string;
}

/** Overlay layers kept above the raster basemap on basemap swaps. */
const OVERLAY_LAYERS: readonly string[] = [
  'an-heat',
  'an-cells-fill',
  'an-cells-line',
  'an-hull-fill',
  'an-hull-line',
  'an-points',
];

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function cellsGeo(cells: readonly MapCell[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: cells.map((c) => ({
      type: 'Feature',
      properties: { color: c.color, opacity: c.opacity ?? 0.55, tip: c.tip ?? '' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [c.west, c.south],
            [c.east, c.south],
            [c.east, c.north],
            [c.west, c.north],
            [c.west, c.south],
          ],
        ],
      },
    })),
  };
}

function heatGeo(points: readonly MapHeatPoint[]): GeoJSON.FeatureCollection {
  const max = points.reduce((m, p) => Math.max(m, p.weight), 0) || 1;
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      properties: { w: p.weight / max },
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    })),
  };
}

function hullGeo(ring: ReadonlyArray<{ lat: number; lng: number }>): GeoJSON.FeatureCollection {
  if (ring.length < 3) return EMPTY;
  const coords = ring.map((p) => [p.lng, p.lat]);
  coords.push(coords[0]);
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } },
    ],
  };
}

function pointsGeo(points: readonly MapPoint[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      properties: { color: p.color, label: p.label ?? '', tip: p.tip ?? '' },
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    })),
  };
}

function raiseAnalyticsLayers(map: MaplibreMap): void {
  for (const id of OVERLAY_LAYERS) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
  const first = OVERLAY_LAYERS.find((id) => map.getLayer(id));
  if (first && map.getLayer('basemap')) map.moveLayer('basemap', first);
}

function ensureLayers(map: MaplibreMap) {
  for (const id of ['an-cells', 'an-heat', 'an-hull', 'an-points']) {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  }
  if (!map.getLayer('an-cells-fill')) {
    map.addLayer({
      id: 'an-cells-fill',
      type: 'fill',
      source: 'an-cells',
      paint: {
        'fill-color': ['to-color', ['get', 'color'], '#98A2B3'],
        'fill-opacity': ['to-number', ['get', 'opacity'], 0.55],
      },
    });
    map.addLayer({
      id: 'an-cells-line',
      type: 'line',
      source: 'an-cells',
      paint: {
        'line-color': ['to-color', ['get', 'color'], '#98A2B3'],
        'line-width': 1.25,
        'line-opacity': 0.95,
      },
    });
  }
  if (!map.getLayer('an-heat')) {
    map.addLayer({
      id: 'an-heat',
      type: 'heatmap',
      source: 'an-heat',
      maxzoom: 16,
      paint: {
        'heatmap-weight': ['get', 'w'],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8, 1, 15, 2.5],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 18, 13, 36, 16, 48],
        'heatmap-opacity': 0.85,
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0,
          'rgba(6,182,212,0)',
          0.2,
          'rgba(6,182,212,0.55)',
          0.45,
          '#06B6D4',
          0.65,
          '#FDB022',
          0.85,
          '#F79009',
          1,
          '#F04438',
        ],
      },
    });
  }
  if (!map.getLayer('an-hull-fill')) {
    map.addLayer({
      id: 'an-hull-fill',
      type: 'fill',
      source: 'an-hull',
      paint: { 'fill-color': '#465FFB', 'fill-opacity': 0.12 },
    });
    map.addLayer({
      id: 'an-hull-line',
      type: 'line',
      source: 'an-hull',
      paint: {
        'line-color': '#465FFB',
        'line-width': 3,
        'line-dasharray': [2, 1.5],
      },
    });
  }
  if (!map.getLayer('an-points')) {
    map.addLayer({
      id: 'an-points',
      type: 'circle',
      source: 'an-points',
      paint: {
        'circle-color': ['to-color', ['get', 'color'], '#F79009'],
        'circle-radius': ['case', ['==', ['get', 'label'], ''], 7, 11],
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-width': 2,
      },
    });
  }
  raiseAnalyticsLayers(map);
}

function tipAt(
  map: MaplibreMap,
  lng: number,
  lat: number,
  points: readonly MapPoint[],
  cells: readonly MapCell[],
): string | null {
  const click = map.project([lng, lat]);
  let best: { d: number; tip: string } | null = null;
  for (const p of points) {
    if (!p.tip) continue;
    const pt = map.project([p.lng, p.lat]);
    const d = Math.hypot(pt.x - click.x, pt.y - click.y);
    if (d <= 18 && (!best || d < best.d)) best = { d, tip: p.tip };
  }
  if (best) return best.tip;
  for (const c of cells) {
    if (!c.tip) continue;
    const south = Math.min(c.south, c.north);
    const north = Math.max(c.south, c.north);
    const west = Math.min(c.west, c.east);
    const east = Math.max(c.west, c.east);
    if (lat >= south && lat <= north && lng >= west && lng <= east) return c.tip;
  }
  return null;
}

function centerInside(
  lng: number,
  lat: number,
  bounds: [[number, number], [number, number]],
): boolean {
  const [[west, south], [east, north]] = bounds;
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

export function AnalyticsMap({
  cells = [],
  heat = [],
  hull = [],
  points = [],
  fitKey,
  focus,
  className = '',
}: AnalyticsMapProps) {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [canvasEl, setCanvasEl] = useState<HTMLElement | null>(null);
  const [viewRev, setViewRev] = useState(0);
  const fitToken = useRef(0);
  const userMoved = useRef(false);
  const fittedKey = useRef<string | undefined>(undefined);
  const cellsRef = useRef(cells);
  const pointsRef = useRef(points);
  cellsRef.current = cells;
  pointsRef.current = points;
  const { basemap, setBasemap } = useFollowBasemap(mapRef, OVERLAY_LAYERS, mapReady);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once by design
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new MaplibreGL({
      container: containerRef.current,
      style: rasterMapStyle(loadPersistedBasemap(), i18n.language),
      center: [51.338, 35.719],
      zoom: 10,
      attributionControl: { compact: true },
      cooperativeGestures: false,
    });
    mapRef.current = map;
    const popup = new Popup({ closeButton: true, maxWidth: '260px' });
    const openTip = (lngLat: { lng: number; lat: number }, tip: string) => {
      const el = document.createElement('div');
      el.style.whiteSpace = 'pre-line';
      el.style.fontSize = '12px';
      el.style.lineHeight = '1.6';
      el.style.color = '#1D2939';
      el.textContent = tip;
      popup.setLngLat(lngLat).setDOMContent(el).addTo(map);
    };
    const showTip = (e: MapLayerMouseEvent) => {
      const tip = e.features?.[0]?.properties?.tip as string | undefined;
      if (!tip) return;
      openTip(e.lngLat, tip);
    };
    const onUserMove = (e: { originalEvent?: Event }) => {
      if (e.originalEvent) userMoved.current = true;
    };
    const onLoad = () => {
      try {
        ensureLayers(map);
        map.on('click', 'an-points', showTip);
        map.on('click', 'an-cells-fill', (e) => {
          if (map.queryRenderedFeatures(e.point, { layers: ['an-points'] }).length > 0) return;
          showTip(e);
        });
        for (const id of ['an-points', 'an-cells-fill']) {
          map.on('mouseenter', id, () => {
            map.getCanvas().style.cursor = 'pointer';
          });
          map.on('mouseleave', id, () => {
            map.getCanvas().style.cursor = '';
          });
        }
      } catch {
        // Style can still project. The SVG overlay does not need the GL layers.
      }
      // GL fills sit under the raster on some basemaps, so a click may not hit
      // a layer. Fall back to the same geometry the SVG is drawing.
      map.on('click', (e) => {
        try {
          const layers = ['an-points', 'an-cells-fill'].filter((id) => map.getLayer(id));
          if (layers.length > 0) {
            const rendered = map.queryRenderedFeatures(e.point, { layers });
            if (rendered.some((f) => f.properties?.tip)) return;
          }
        } catch {
          // Layer query can throw before the style has those layers.
        }
        const tip = tipAt(map, e.lngLat.lng, e.lngLat.lat, pointsRef.current, cellsRef.current);
        if (tip) openTip(e.lngLat, tip);
      });
      map.resize();
      setCanvasEl(map.getCanvasContainer());
      setMapReady(true);
    };
    runWhenStyleReady(map, onLoad);
    map.on('dragstart', onUserMove);
    map.on('zoomstart', onUserMove);
    map.on('rotatestart', onUserMove);
    map.on('pitchstart', onUserMove);

    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.resize()) : undefined;
    ro?.observe(containerRef.current);
    return () => {
      ro?.disconnect();
      popup.remove();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
      setCanvasEl(null);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let frame = 0;
    const bump = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setViewRev((n) => n + 1);
      });
    };
    map.on('move', bump);
    map.on('resize', bump);
    bump();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      map.off('move', bump);
      map.off('resize', bump);
    };
  }, [mapReady]);

  // Push data into the sources. SVG reads the same props, so a GL miss still
  // leaves the colored ranges on screen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    try {
      ensureLayers(map);
      (map.getSource('an-cells') as GeoJSONSource).setData(cellsGeo(cells));
      (map.getSource('an-heat') as GeoJSONSource).setData(heatGeo(heat));
      (map.getSource('an-hull') as GeoJSONSource).setData(hullGeo(hull));
      (map.getSource('an-points') as GeoJSONSource).setData(pointsGeo(points));
      raiseAnalyticsLayers(map);
      map.triggerRepaint();
    } catch {
      // Overlay below still paints from the React props.
    }
  }, [cells, heat, hull, points, mapReady]);

  // Frame the data. Duration 0: an animated fit was cancelled by resize()
  // and by the basemap helper's jumpTo, which left the default city on screen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (fittedKey.current === fitKey && userMoved.current) return;
    userMoved.current = false;
    fittedKey.current = fitKey;
    const token = ++fitToken.current;
    const bounds = analyticsViewBounds({ cells, heat, hull, points });
    if (!bounds) return;

    const apply = (attempt: number) => {
      if (fitToken.current !== token || userMoved.current) return;
      const live = mapRef.current;
      const el = containerRef.current;
      if (!live || !el) return;
      live.resize();
      if ((el.clientWidth < 32 || el.clientHeight < 32) && attempt < 40) {
        requestAnimationFrame(() => apply(attempt + 1));
        return;
      }
      live.stop();
      live.fitBounds(bounds, {
        padding: { top: 36, bottom: 72, left: 36, right: 48 },
        maxZoom: 15,
        duration: 0,
      });
      setViewRev((n) => n + 1);
    };

    const frame = requestAnimationFrame(() => apply(0));
    // Basemap swaps call jumpTo up to ~200ms after ready and undo the fit.
    const followUp = window.setTimeout(() => {
      if (fitToken.current !== token || userMoved.current) return;
      const live = mapRef.current;
      if (!live) return;
      const c = live.getCenter();
      if (!centerInside(c.lng, c.lat, bounds)) apply(0);
    }, 400);

    return () => {
      fitToken.current += 1;
      cancelAnimationFrame(frame);
      window.clearTimeout(followUp);
    };
  }, [fitKey, mapReady, cells, heat, hull, points]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !focus) return;
    fitToken.current += 1;
    userMoved.current = true;
    map.stop();
    map.flyTo({
      center: [focus.lng, focus.lat],
      zoom: Math.max(map.getZoom(), 15),
      duration: 0,
    });
  }, [focus, mapReady]);

  const overlay =
    mapReady && canvasEl
      ? projectAnalyticsOverlay(
          {
            cells: cells as readonly CellSample[],
            heat: heat as readonly HeatSample[],
            hull: hull as readonly LngLat[],
            points: points as readonly PointSample[],
          },
          (lng, lat) => {
            const p = mapRef.current?.project([lng, lat]);
            return { x: p?.x ?? Number.NaN, y: p?.y ?? Number.NaN };
          },
          {
            w: mapRef.current?.getContainer().clientWidth ?? 0,
            h: mapRef.current?.getContainer().clientHeight ?? 0,
          },
        )
      : null;
  return (
    <div className={`relative h-full w-full overflow-hidden ${className}`}>
      <div ref={containerRef} className="h-full w-full" data-testid="analytics-map" />
      {canvasEl && overlay
        ? createPortal(
            <svg
              data-testid="analytics-map-overlay"
              data-rev={viewRev}
              aria-hidden
              width={overlay.w}
              height={overlay.h}
              viewBox={`0 0 ${overlay.w} ${overlay.h}`}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                zIndex: 1,
                width: overlay.w,
                height: overlay.h,
                pointerEvents: 'none',
                overflow: 'visible',
              }}
            >
              <title>{t('spatial.title')}</title>
              {overlay.cells.map((cell) => (
                <polygon
                  key={`${cell.color}|${cell.opacity}|${cell.points}`}
                  points={cell.points}
                  fill={cell.color}
                  fillOpacity={cell.opacity}
                  stroke="#ffffff"
                  strokeWidth={1.25}
                  strokeOpacity={0.9}
                />
              ))}
              {overlay.heat.map((dot) => (
                <circle
                  key={`h-${dot.x}-${dot.y}`}
                  cx={dot.x}
                  cy={dot.y}
                  r={dot.r}
                  fill={dot.color}
                  fillOpacity={0.85}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                />
              ))}
              {overlay.hull ? (
                <g>
                  <polygon
                    points={overlay.hull}
                    fill="rgba(70,95,251,0.14)"
                    stroke="#ffffff"
                    strokeWidth={6}
                    strokeLinejoin="round"
                  />
                  <polygon
                    points={overlay.hull}
                    fill="none"
                    stroke="#465FFB"
                    strokeWidth={2.5}
                    strokeDasharray="8 6"
                    strokeLinejoin="round"
                  />
                </g>
              ) : null}
              {overlay.points.map((dot) => (
                <circle
                  key={`p-${dot.x}-${dot.y}-${dot.color}`}
                  cx={dot.x}
                  cy={dot.y}
                  r={dot.r}
                  fill={dot.color}
                  stroke="#ffffff"
                  strokeWidth={2}
                />
              ))}
            </svg>,
            canvasEl,
          )
        : null}
      <MapSettingsPanel basemap={basemap} onBasemapChange={setBasemap} placement="corner" />
    </div>
  );
}
