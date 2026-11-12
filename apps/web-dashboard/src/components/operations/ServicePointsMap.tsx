/**
 * Where each service loaded and dumped.
 *
 * The route's origin and destination are outlined; every service puts a
 * numbered green pin where the truck stood under the shovel and a numbered red
 * pin where it dumped, joined by a dashed line. The numbers match the rows of
 * the service list next to the map; the selected service is drawn on top.
 *
 * Zones and lines are an SVG overlay projected from the map (the same approach
 * as the geofence preview), so the opaque raster basemap never hides them.
 */
import { Map as MaplibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GeoPoint } from '@/api/operations.api';
import { MapSettingsPanel } from '@/components/map/MapSettingsPanel';
import { NO_OVERLAY_LAYERS, useFollowBasemap } from '@/hooks/useBasemap';
import { loadPersistedBasemap, rasterMapStyle } from '@/lib/basemaps';
import { geofenceRing } from '@/lib/geofence-geo';
import { runWhenStyleReady } from '@/lib/map-ready';
import type { Geofence } from '@/types/geofence.types';

export const LOAD_COLOR = '#12B76A';
export const DUMP_COLOR = '#F04438';
const SELECTED_COLOR = '#0EA5E9';

export interface ServicePoint {
  /** Number shown on the pins and in the list (1-based). */
  readonly no: number;
  readonly load: GeoPoint;
  readonly dump: GeoPoint;
  readonly title: string;
}

function pin(no: number, color: string, selected: boolean, title: string): HTMLElement {
  const el = document.createElement('div');
  const size = selected ? 28 : 22;
  el.style.cssText = [
    `width:${size}px`,
    `height:${size}px`,
    'border-radius:9999px',
    `background:${color}`,
    `border:2px solid ${selected ? SELECTED_COLOR : '#fff'}`,
    'box-shadow:0 1px 3px rgba(0,0,0,.45)',
    'color:#fff',
    `font:600 ${selected ? 12 : 10}px/1 system-ui,sans-serif`,
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'cursor:pointer',
  ].join(';');
  el.textContent = String(no);
  el.title = title;
  return el;
}

export function ServicePointsMap({
  points,
  zones,
  selectedNo,
  onSelect,
  height = 360,
}: {
  points: readonly ServicePoint[];
  /** The route's origin and destination places. */
  zones: { origin?: Geofence | null; destination?: Geofence | null };
  selectedNo: number | null;
  onSelect: (no: number) => void;
  height?: number;
}) {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const fittedRef = useRef('');
  const [mapReady, setMapReady] = useState(false);
  const [, setViewRev] = useState(0);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const { basemap, setBasemap } = useFollowBasemap(mapRef, NO_OVERLAY_LAYERS, mapReady);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once by design
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new MaplibreMap({
      container: containerRef.current,
      style: rasterMapStyle(loadPersistedBasemap(), i18n.language),
      center: [51.338, 35.719],
      zoom: 12,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    setMapReady(true);
    const bump = () => setViewRev((n) => n + 1);
    map.on('move', bump);
    map.on('resize', bump);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => map.resize());
      ro.observe(containerRef.current);
    }
    return () => {
      ro?.disconnect();
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // Pins, and the camera on the first paint of a new set of services.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const render = () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      const lngs: number[] = [];
      const lats: number[] = [];
      for (const zone of [zones.origin, zones.destination]) {
        for (const [lng, lat] of (zone ? geofenceRing(zone) : null) ?? []) {
          lngs.push(lng ?? 0);
          lats.push(lat ?? 0);
        }
      }
      // The selected service last, so its pins sit on top.
      const ordered = [...points].sort(
        (a, b) => Number(a.no === selectedNo) - Number(b.no === selectedNo),
      );
      for (const p of ordered) {
        const selected = p.no === selectedNo;
        for (const [at, color, kind] of [
          [p.load, LOAD_COLOR, t('operations.ui.services.loadedHere')],
          [p.dump, DUMP_COLOR, t('operations.ui.services.dumpedHere')],
        ] as const) {
          const el = pin(p.no, color, selected, `${p.no} · ${kind} · ${p.title}`);
          el.dataset.testid = `service-pin-${p.no}`;
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            onSelectRef.current(p.no);
          });
          const marker = new Marker({ element: el }).setLngLat([at.lng, at.lat]).addTo(map);
          // Above the SVG lines (z 1); MapLibre resets the marker's own style on add.
          marker.getElement().style.zIndex = selected ? '3' : '2';
          markersRef.current.push(marker);
          lngs.push(at.lng);
          lats.push(at.lat);
        }
      }

      const key = `${points.map((p) => p.no).join(',')}|${zones.origin?.id ?? ''}|${zones.destination?.id ?? ''}`;
      if (key !== fittedRef.current && lngs.length > 0) {
        fittedRef.current = key;
        map.fitBounds(
          [
            [Math.min(...lngs), Math.min(...lats)],
            [Math.max(...lngs), Math.max(...lats)],
          ],
          { padding: 48, maxZoom: 17, duration: 0 },
        );
      } else {
        const chosen = points.find((p) => p.no === selectedNo);
        if (chosen) {
          map.easeTo({
            center: [
              (chosen.load.lng + chosen.dump.lng) / 2,
              (chosen.load.lat + chosen.dump.lat) / 2,
            ],
            duration: 400,
          });
        }
      }
    };
    runWhenStyleReady(map, render);
  }, [points, zones.origin, zones.destination, selectedNo, t]);

  // Zones and load → dump lines, projected on every move.
  const overlay = (() => {
    const map = mapRef.current;
    if (!mapReady || !map) return null;
    const w = map.getContainer().clientWidth;
    const h = map.getContainer().clientHeight;
    if (w < 8 || h < 8) return null;
    const xy = (lng: number, lat: number) => {
      const pt = map.project([lng, lat]);
      return Number.isFinite(pt.x) && Number.isFinite(pt.y) ? pt : null;
    };
    const polygons: Array<{ key: string; points: string; color: string }> = [];
    for (const [zone, color] of [
      [zones.origin, LOAD_COLOR],
      [zones.destination, DUMP_COLOR],
    ] as const) {
      const ring = zone ? geofenceRing(zone) : null;
      if (!zone || !ring) continue;
      const pts = ring.map(([lng, lat]) => xy(lng ?? 0, lat ?? 0));
      if (pts.some((pt) => !pt)) continue;
      polygons.push({
        key: zone.id,
        color,
        points: pts.map((pt) => `${pt?.x},${pt?.y}`).join(' '),
      });
    }
    const legs = [...points]
      .sort((a, b) => Number(a.no === selectedNo) - Number(b.no === selectedNo))
      .flatMap((p) => {
        const a = xy(p.load.lng, p.load.lat);
        const b = xy(p.dump.lng, p.dump.lat);
        return a && b ? [{ no: p.no, a, b, selected: p.no === selectedNo }] : [];
      });
    return { w, h, polygons, legs };
  })();

  return (
    <div className="relative isolate overflow-hidden rounded-lg" style={{ width: '100%', height }}>
      <div
        ref={containerRef}
        className="relative h-full w-full"
        data-testid="service-points-map"
        role="img"
        aria-label={t('operations.ui.services.mapLabel')}
      />
      {overlay ? (
        <svg
          className="pointer-events-none absolute start-0 top-0"
          style={{ zIndex: 1, width: overlay.w, height: overlay.h }}
          viewBox={`0 0 ${overlay.w} ${overlay.h}`}
          aria-hidden
          data-testid="service-points-overlay"
        >
          <title>{t('operations.ui.services.mapLabel')}</title>
          {overlay.polygons.map((poly) => (
            <polygon
              key={poly.key}
              points={poly.points}
              fill={poly.color}
              fillOpacity={0.12}
              stroke={poly.color}
              strokeWidth={2.5}
            />
          ))}
          {overlay.legs.map((leg) => (
            <line
              key={leg.no}
              x1={leg.a.x}
              y1={leg.a.y}
              x2={leg.b.x}
              y2={leg.b.y}
              stroke={leg.selected ? SELECTED_COLOR : '#334155'}
              strokeOpacity={leg.selected ? 1 : 0.65}
              strokeWidth={leg.selected ? 3.5 : 1.75}
              strokeDasharray="6 5"
            />
          ))}
        </svg>
      ) : null}
      <MapSettingsPanel basemap={basemap} onBasemapChange={setBasemap} placement="corner" />
    </div>
  );
}
