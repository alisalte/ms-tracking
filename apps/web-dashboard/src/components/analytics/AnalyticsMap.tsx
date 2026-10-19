import { Map as MaplibreGL, Popup } from 'maplibre-gl';
import type { GeoJSONSource, MapLayerMouseEvent, Map as MaplibreMap } from 'maplibre-gl';
/**
 * AnalyticsMap — the shared MapLibre canvas of the spatial analytics page.
 *
 * Renders GeoJSON overlays on the shared raster basemap:
 * - `cells`   — colored grid squares (GPS coverage levels / activity), each
 *               with a plain-text tooltip shown on tap/click.
 * - `heat`    — weighted points painted as a heatmap at low zoom.
 * - `hull`    — the derived project area outline.
 * - `points`  — dots for stop hotspots / GPS-loss alarms (larger when `label`
 *               is set; the raster style has no glyphs, so ranks live in the
 *               side list).
 *
 * Sources are updated in place (`setData`) so filter changes do not rebuild
 * the map. `fitKey` changes re-frame the view on the new data.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MapSettingsPanel } from '@/components/map/MapSettingsPanel';
import { useFollowBasemap } from '@/hooks/useBasemap';
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

function ensureLayers(map: MaplibreMap) {
  for (const id of ['an-cells', 'an-heat', 'an-hull', 'an-points']) {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
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
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 10, 13, 26, 16, 40],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.85, 16, 0.25],
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0,
          'rgba(70,95,251,0)',
          0.2,
          'rgba(70,95,251,0.45)',
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
  if (!map.getLayer('an-cells-fill')) {
    map.addLayer({
      id: 'an-cells-fill',
      type: 'fill',
      source: 'an-cells',
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'] },
    });
    map.addLayer({
      id: 'an-cells-line',
      type: 'line',
      source: 'an-cells',
      paint: { 'line-color': ['get', 'color'], 'line-width': 0.6, 'line-opacity': 0.9 },
    });
  }
  if (!map.getLayer('an-hull-fill')) {
    map.addLayer({
      id: 'an-hull-fill',
      type: 'fill',
      source: 'an-hull',
      paint: { 'fill-color': '#465FFB', 'fill-opacity': 0.06 },
    });
    map.addLayer({
      id: 'an-hull-line',
      type: 'line',
      source: 'an-hull',
      paint: { 'line-color': '#465FFB', 'line-width': 2.5, 'line-dasharray': [2, 1.5] },
    });
  }
  if (!map.getLayer('an-points')) {
    map.addLayer({
      id: 'an-points',
      type: 'circle',
      source: 'an-points',
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': ['case', ['==', ['get', 'label'], ''], 6, 11],
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-width': 2,
      },
    });
  }
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
  const { i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
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
    const showTip = (e: MapLayerMouseEvent) => {
      const tip = e.features?.[0]?.properties?.tip as string | undefined;
      if (!tip) return;
      const el = document.createElement('div');
      el.style.whiteSpace = 'pre-line';
      el.style.fontSize = '12px';
      el.style.lineHeight = '1.6';
      el.style.color = '#1D2939';
      el.textContent = tip;
      popup.setLngLat(e.lngLat).setDOMContent(el).addTo(map);
    };
    const onLoad = () => {
      ensureLayers(map);
      map.on('click', 'an-points', showTip);
      map.on('click', 'an-cells-fill', (e) => {
        // Points sit above cells — let the point popup win.
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
      map.resize();
      setMapReady(true);
    };
    // The style is enough for overlays — do not wait for every basemap tile
    // (`load`), which never completes when the tile server is unreachable.
    runWhenStyleReady(map, onLoad);

    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.resize()) : undefined;
    ro?.observe(containerRef.current);
    return () => {
      ro?.disconnect();
      popup.remove();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // Push data into the sources.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    // `mapReady` means the overlay sources exist; GeoJSON `setData` does not
    // need the basemap tiles to finish (gating on `loaded()` stalled here).
    ensureLayers(map);
    (map.getSource('an-cells') as GeoJSONSource).setData(cellsGeo(cells));
    (map.getSource('an-heat') as GeoJSONSource).setData(heatGeo(heat));
    (map.getSource('an-hull') as GeoJSONSource).setData(hullGeo(hull));
    (map.getSource('an-points') as GeoJSONSource).setData(pointsGeo(points));
  }, [cells, heat, hull, points, mapReady]);

  // Frame the data when the dataset changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-frame only on fitKey
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let minLat = Number.POSITIVE_INFINITY;
    let minLng = Number.POSITIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;
    let maxLng = Number.NEGATIVE_INFINITY;
    const take = (lat: number, lng: number) => {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    };
    if (hull.length >= 3) for (const p of hull) take(p.lat, p.lng);
    else {
      for (const c of cells) {
        take(c.south, c.west);
        take(c.north, c.east);
      }
      for (const p of points) take(p.lat, p.lng);
    }
    if (!Number.isFinite(minLat)) return;
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 40, maxZoom: 15, duration: 500 },
    );
  }, [fitKey, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !focus) return;
    map.flyTo({ center: [focus.lng, focus.lat], zoom: Math.max(map.getZoom(), 15), duration: 700 });
  }, [focus, mapReady]);

  return (
    <div className={`relative h-full w-full overflow-hidden ${className}`}>
      <div ref={containerRef} className="h-full w-full" />
      <MapSettingsPanel basemap={basemap} onBasemapChange={setBasemap} placement="corner" />
    </div>
  );
}
