/**
 * GeofencePreviewMap — read-only map of one or many saved geofences.
 *
 * Single-fence mode (detail dialog): fill + outline, camera fits that ring.
 * Overview mode (`geofences`): every fence is painted; the selected one is
 * highlighted so it is obvious which area is chosen. Click a fill to select.
 *
 * Raster basemaps are opaque. An SVG overlay (same approach as the draw map)
 * paints interiors above the tiles so the selected area is never hidden.
 */
import { type GeoJSONSource, Map as MaplibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { drawRingForFill } from '@/components/geofences/GeofenceDrawMap';
import { MapSettingsPanel } from '@/components/map/MapSettingsPanel';
import { useFollowBasemap } from '@/hooks/useBasemap';
import { loadPersistedBasemap, rasterMapStyle } from '@/lib/basemaps';
import { geofenceFeature, geofenceRing, ringCentroid } from '@/lib/geofence-geo';
import { runWhenStyleReady } from '@/lib/map-ready';
import { mapAccents } from '@/theme/palette';
import type { Geofence } from '@/types/geofence.types';

const PREVIEW_OVERLAY_LAYER_IDS = [
  'geofence-preview-fill',
  'geofence-preview-halo',
  'geofence-preview-line-casing',
  'geofence-preview-line',
] as const;

const PREVIEW_BASEMAP_BEFORE = ['geofence-preview-fill'] as const;

function raisePreviewLayers(map: MaplibreMap): void {
  for (const id of PREVIEW_OVERLAY_LAYER_IDS) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
  if (map.getLayer('basemap') && map.getLayer('geofence-preview-fill')) {
    map.moveLayer('basemap', 'geofence-preview-fill');
  }
}

/** Closed ring MapLibre can fill (bow-tie four-corners become a simple quad). */
export function fillableClosedRing(ring: number[][]): number[][] {
  const pts = drawRingForFill(ring);
  const first = pts[0];
  if (!first || pts.length < 3) return ring;
  return [...pts, first];
}

function projectRingPoints(map: MaplibreMap, ring: number[][]): string | null {
  const parts: string[] = [];
  for (const p of ring) {
    const pt = map.project([p[0] ?? 0, p[1] ?? 0]);
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null;
    parts.push(`${pt.x},${pt.y}`);
  }
  return parts.length >= 3 ? parts.join(' ') : null;
}

export function GeofencePreviewMap({
  geofence,
  geofences,
  selectedId,
  onSelect,
  height = 320,
}: {
  geofence?: Geofence | null;
  geofences?: readonly Geofence[];
  selectedId?: string | null;
  onSelect?: (g: Geofence) => void;
  height?: number;
}) {
  const { t, i18n } = useTranslation();
  const overlayUid = useId();
  const hatchId = `fv-preview-${overlayUid.replace(/:/g, '')}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const labelsRef = useRef<Marker[]>([]);
  const fittedKeyRef = useRef('');
  const items = geofences ?? (geofence ? [geofence] : []);
  const highlightId = selectedId ?? geofence?.id ?? null;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const { basemap, setBasemap } = useFollowBasemap(mapRef, PREVIEW_BASEMAP_BEFORE, mapReady);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once by design
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new MaplibreMap({
      container: containerRef.current,
      style: rasterMapStyle(loadPersistedBasemap(), i18n.language),
      center: [51.338, 35.719],
      zoom: 10,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    setMapReady(true);
    map.on('load', () => {
      map.addSource('geofence-preview', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'geofence-preview-fill',
        type: 'fill',
        source: 'geofence-preview',
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['get', 'selected'], false],
            mapAccents.geofence,
            '#64748B',
          ],
          'fill-opacity': ['case', ['boolean', ['get', 'selected'], false], 0.45, 0.28],
        },
      });
      map.addLayer({
        id: 'geofence-preview-halo',
        type: 'line',
        source: 'geofence-preview',
        filter: ['==', ['get', 'selected'], true],
        paint: {
          'line-color': mapAccents.geofence,
          'line-width': 16,
          'line-opacity': 0.28,
          'line-blur': 8,
        },
      });
      map.addLayer({
        id: 'geofence-preview-line-casing',
        type: 'line',
        source: 'geofence-preview',
        paint: { 'line-color': '#FFFFFF', 'line-width': 7, 'line-opacity': 0.95 },
      });
      map.addLayer({
        id: 'geofence-preview-line',
        type: 'line',
        source: 'geofence-preview',
        paint: {
          'line-color': [
            'case',
            ['boolean', ['get', 'selected'], false],
            mapAccents.geofence,
            '#475569',
          ],
          'line-width': ['case', ['boolean', ['get', 'selected'], false], 4, 2.5],
        },
      });
      raisePreviewLayers(map);
      map.on('click', 'geofence-preview-fill', (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        const hit = itemsRef.current.find((g) => g.id === id);
        if (hit) onSelectRef.current?.(hit);
      });
      map.on('mouseenter', 'geofence-preview-fill', () => {
        map.getCanvas().style.cursor = onSelectRef.current ? 'pointer' : '';
      });
      map.on('mouseleave', 'geofence-preview-fill', () => {
        map.getCanvas().style.cursor = '';
      });
    });
    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const render = () => {
      const src = map.getSource('geofence-preview') as GeoJSONSource | undefined;
      if (!src) {
        runWhenStyleReady(map, () => {
          if (map.getSource('geofence-preview')) render();
        });
        return;
      }
      for (const m of labelsRef.current) m.remove();
      labelsRef.current = [];
      const features: GeoJSON.Feature[] = [];
      const allLngs: number[] = [];
      const allLats: number[] = [];
      const focusLngs: number[] = [];
      const focusLats: number[] = [];
      for (const g of items) {
        const feat = geofenceFeature(g, { selected: g.id === highlightId });
        if (!feat) continue;
        const fillRing = fillableClosedRing(feat.geometry.coordinates[0] ?? []);
        feat.geometry.coordinates = [fillRing];
        features.push(feat);
        for (const p of fillRing) {
          allLngs.push(p[0] ?? 0);
          allLats.push(p[1] ?? 0);
          if (g.id === highlightId) {
            focusLngs.push(p[0] ?? 0);
            focusLats.push(p[1] ?? 0);
          }
        }
        const el = document.createElement('div');
        el.className = g.id === highlightId ? 'fv-geofence-label is-selected' : 'fv-geofence-label';
        el.textContent = g.name;
        labelsRef.current.push(
          new Marker({ element: el, anchor: 'center' })
            .setLngLat(ringCentroid(fillRing))
            .addTo(map),
        );
      }
      map.resize();
      src.setData({ type: 'FeatureCollection', features });
      raisePreviewLayers(map);
      map.triggerRepaint();
      const fitLngs = focusLngs.length > 0 ? focusLngs : allLngs;
      const fitLats = focusLats.length > 0 ? focusLats : allLats;
      const fitKey = `${items.map((g) => g.id).join(',')}|${highlightId ?? ''}`;
      if (fitKey !== fittedKeyRef.current && fitLngs.length >= 1 && fitLats.length >= 1) {
        fittedKeyRef.current = fitKey;
        map.stop();
        map.fitBounds(
          [
            [Math.min(...fitLngs), Math.min(...fitLats)],
            [Math.max(...fitLngs), Math.max(...fitLats)],
          ],
          { padding: 48, maxZoom: 16, duration: highlightId ? 400 : 0 },
        );
      }
    };
    render();
    return () => {
      for (const m of labelsRef.current) m.remove();
      labelsRef.current = [];
    };
  }, [items, highlightId]);

  const [, setViewRev] = useState(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const bump = () => setViewRev((n) => n + 1);
    map.on('move', bump);
    map.on('resize', bump);
    return () => {
      map.off('move', bump);
      map.off('resize', bump);
    };
  }, [mapReady]);

  const selectionOverlay = (() => {
    if (!mapReady) return null;
    const map = mapRef.current;
    if (!map) return null;
    const w = map.getContainer().clientWidth;
    const h = map.getContainer().clientHeight;
    if (w < 8 || h < 8) return null;
    const polygons: { points: string; selected: boolean }[] = [];
    for (const g of items) {
      const ring = geofenceRing(g);
      if (!ring) continue;
      const points = projectRingPoints(map, drawRingForFill(ring));
      if (!points) continue;
      polygons.push({ points, selected: g.id === highlightId });
    }
    if (polygons.length === 0) return null;
    return { w, h, polygons };
  })();

  if (items.length === 0) return null;

  return (
    <div className="relative isolate overflow-hidden rounded-lg" style={{ width: '100%', height }}>
      <div
        ref={containerRef}
        className="relative z-0 h-full w-full"
        data-testid="geofence-preview-map"
        role="img"
        aria-label={
          geofence
            ? `Geofence ${geofence.name} preview`
            : t('geofences.overviewMap', { defaultValue: 'All geofences on the map' })
        }
      />
      {selectionOverlay ? (
        <svg
          className="pointer-events-none absolute start-0 top-0"
          style={{ zIndex: 2, width: selectionOverlay.w, height: selectionOverlay.h }}
          viewBox={`0 0 ${selectionOverlay.w} ${selectionOverlay.h}`}
          width={selectionOverlay.w}
          height={selectionOverlay.h}
          aria-hidden
          data-testid="geofence-preview-overlay"
        >
          <title>
            {t('geofences.previewOverlay', { defaultValue: 'Geofence areas on the map' })}
          </title>
          <defs>
            <pattern
              id={`${hatchId}-on`}
              patternUnits="userSpaceOnUse"
              width="10"
              height="10"
              patternTransform="rotate(-35)"
            >
              <rect width="10" height="10" fill={mapAccents.geofence} fillOpacity="0.22" />
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="10"
                stroke={mapAccents.geofence}
                strokeWidth="3"
                strokeOpacity="0.85"
              />
            </pattern>
            <pattern
              id={`${hatchId}-off`}
              patternUnits="userSpaceOnUse"
              width="10"
              height="10"
              patternTransform="rotate(-35)"
            >
              <rect width="10" height="10" fill="#64748B" fillOpacity="0.14" />
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="10"
                stroke="#475569"
                strokeWidth="2"
                strokeOpacity="0.55"
              />
            </pattern>
          </defs>
          {selectionOverlay.polygons.map((poly) => (
            <g key={poly.points}>
              <polygon
                points={poly.points}
                fill={poly.selected ? mapAccents.geofence : '#64748B'}
                fillOpacity={poly.selected ? 0.4 : 0.22}
                stroke={poly.selected ? mapAccents.geofence : '#475569'}
                strokeWidth={poly.selected ? 4 : 2}
              />
              <polygon
                points={poly.points}
                fill={`url(#${poly.selected ? `${hatchId}-on` : `${hatchId}-off`})`}
              />
            </g>
          ))}
        </svg>
      ) : null}
      <MapSettingsPanel basemap={basemap} onBasemapChange={setBasemap} placement="corner" />
    </div>
  );
}
