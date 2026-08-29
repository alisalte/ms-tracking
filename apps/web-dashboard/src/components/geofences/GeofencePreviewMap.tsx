/**
 * GeofencePreviewMap — read-only map of one or many saved geofences.
 *
 * Single-fence mode (detail dialog): fill + outline, camera fits that ring.
 * Overview mode (`geofences`): every fence is painted; the selected one is
 * highlighted so it is obvious which area is chosen. Click a fill to select.
 */
import { type GeoJSONSource, Map as MaplibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MapSettingsPanel } from '@/components/map/MapSettingsPanel';
import { useFollowBasemap } from '@/hooks/useBasemap';
import { loadPersistedBasemap, rasterMapStyle } from '@/lib/basemaps';
import { geofenceFeature, geofenceRing, ringCentroid } from '@/lib/geofence-geo';
import { runWhenStyleReady } from '@/lib/map-ready';
import { mapAccents } from '@/theme/palette';
import type { Geofence } from '@/types/geofence.types';

const PREVIEW_BASEMAP_BEFORE = ['geofence-preview-fill'] as const;

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
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const labelsRef = useRef<Marker[]>([]);
  const fittedIdsRef = useRef('');
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
          'fill-color': ['case', ['==', ['get', 'selected'], 1], mapAccents.geofence, '#64748B'],
          'fill-opacity': ['case', ['==', ['get', 'selected'], 1], 0.36, 0.16],
        },
      });
      map.addLayer({
        id: 'geofence-preview-halo',
        type: 'line',
        source: 'geofence-preview',
        filter: ['==', ['get', 'selected'], 1],
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
          'line-color': ['case', ['==', ['get', 'selected'], 1], mapAccents.geofence, '#475569'],
          'line-width': ['case', ['==', ['get', 'selected'], 1], 3.5, 2],
        },
      });
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
      const lngs: number[] = [];
      const lats: number[] = [];
      for (const g of items) {
        const feat = geofenceFeature(g, { selected: g.id === highlightId ? 1 : 0 });
        if (!feat) continue;
        features.push(feat);
        const ring = geofenceRing(g);
        if (!ring) continue;
        for (const p of ring) {
          lngs.push(p[0] ?? 0);
          lats.push(p[1] ?? 0);
        }
        const el = document.createElement('div');
        el.className = g.id === highlightId ? 'fv-geofence-label is-selected' : 'fv-geofence-label';
        el.textContent = g.name;
        labelsRef.current.push(
          new Marker({ element: el, anchor: 'center' }).setLngLat(ringCentroid(ring)).addTo(map),
        );
      }
      map.resize();
      src.setData({ type: 'FeatureCollection', features });
      const idKey = items.map((g) => g.id).join(',');
      if (idKey !== fittedIdsRef.current && lngs.length >= 1 && lats.length >= 1) {
        fittedIdsRef.current = idKey;
        map.stop();
        map.fitBounds(
          [
            [Math.min(...lngs), Math.min(...lats)],
            [Math.max(...lngs), Math.max(...lats)],
          ],
          { padding: 48, maxZoom: 16, duration: 0 },
        );
      }
    };
    render();
    return () => {
      for (const m of labelsRef.current) m.remove();
      labelsRef.current = [];
    };
  }, [items, highlightId]);

  if (items.length === 0) return null;

  return (
    <div className="relative" style={{ width: '100%', height }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height, borderRadius: 8, overflow: 'hidden' }}
        data-testid="geofence-preview-map"
        role="img"
        aria-label={
          geofence
            ? `Geofence ${geofence.name} preview`
            : t('geofences.overviewMap', { defaultValue: 'All geofences on the map' })
        }
      />
      <MapSettingsPanel basemap={basemap} onBasemapChange={setBasemap} placement="corner" />
    </div>
  );
}
