import type { TFunction } from 'i18next';
import { Map as MaplibreMap, Marker as MaplibreMarker, Popup as MaplibrePopup } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { cluster, expandZoom } from '@/lib/map-cluster';
import {
  clusterMarkerDataUrl,
  headingArrowDataUrl,
  markerDataUrl,
  selectedMarkerDataUrl,
  vehicleColor,
} from '@/lib/map-markers';
import { mapAccents } from '@/theme/palette';
import type { MapVehicle } from '@/types/fleet.types';

interface FleetMapProps {
  /** The (already-filtered) fleet to render. */
  vehicles: MapVehicle[];
  /** Currently selected vehicle id, if any. */
  selectedId?: string | null;
  /** Select a vehicle (opens the drawer). */
  onSelect?: (id: string) => void;
  /** Clear the current selection (e.g. on backdrop click). */
  onDeselect?: () => void;
  /** When true, freeze live updates — markers stop syncing (UI_UX_Design.md §2.7). */
  paused?: boolean;
}

/** Freshness "age" of the last position fix, locale-aware. */
function ageLabel(updatedAt: string | undefined, t: TFunction) {
  if (!updatedAt) return '';
  const sec = Math.max(0, Math.round((Date.now() - new Date(updatedAt).getTime()) / 1000));
  if (sec < 60) return t('map.popup.updatedNow');
  const min = Math.round(sec / 60);
  if (min < 60) return t('map.popup.updatedMin', { count: min });
  const hr = Math.round(min / 60);
  return t('map.popup.updatedHour', { count: hr });
}

/**
 * FleetMap — the full-bleed real-time map for the Live Tracking page.
 *
 * UI_UX_Design.md §2.2–§2.7: free OSM raster tiles via MapLibre GL, vehicle
 * markers colored by status (cyan/yellow/rose/slate) and rotated to heading,
 * client-side clustering with `supercluster` (count bubbles, click → zoom in),
 * hover tooltip, and a selection highlight. Markers are managed imperatively
 * (create/remove via MapLibre, tracked in a ref) exactly like the dashboard
 * preview — that pattern is proven and avoids React reconciliation cost.
 */
export function FleetMap({
  vehicles,
  selectedId,
  onSelect,
  onDeselect,
  paused = false,
}: FleetMapProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const markersRef = useRef<MaplibreMarker[]>([]);

  // Keep the latest callbacks in refs so the map init effect stays mount-once
  // and the marker effect depends only on data (not on changing function refs).
  const onSelectRef = useRef(onSelect);
  const onDeselectRef = useRef(onDeselect);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onDeselectRef.current = onDeselect;
  });

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
      zoom: 11,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    // Clicking empty map clears the selection (§2.5 Esc/backdrop closes).
    map.on('click', (e) => {
      // If the click originated on a marker element, ignore (markers stop propagation).
      if (
        e.originalEvent.target &&
        (e.originalEvent.target as HTMLElement).closest('.fv-vehicle-marker')
      ) {
        return;
      }
      onDeselectRef.current?.();
    });

    return () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Re-render markers whenever the fleet / selection changes. When paused, the
  // map stops re-clustering on pan/zoom so the operator can inspect a frozen
  // view (UI_UX_Design.md §2.7 "pause live").
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const sync = () => {
      const zoom = map.getZoom();
      const bounds = map.getBounds();
      const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()] as [
        number,
        number,
        number,
        number,
      ];
      const features = cluster(vehicles, bbox, zoom);

      for (const m of markersRef.current) m.remove();
      markersRef.current = features.map((feat) => {
        const el = document.createElement('img');
        el.className = 'fv-vehicle-marker';

        if (feat.kind === 'cluster') {
          el.src = clusterMarkerDataUrl(feat.count, mapAccents.vehicleActive);
          el.alt = t('map.clusterAlt', { count: feat.count });
          el.style.cursor = 'pointer';
          const marker = new MaplibreMarker({ element: el, anchor: 'center' }).setLngLat([
            feat.lng,
            feat.lat,
          ]);
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const z = expandZoom(feat.id, zoom);
            map.flyTo({ center: [feat.lng, feat.lat], zoom: Math.min(z, 18) });
          });
          marker.addTo(map);
          return marker;
        }

        const v = feat.vehicle;
        const isSel = v.id === selectedId;
        const moving = v.state === 'driving' || v.state === 'overspeed';
        el.src = isSel
          ? selectedMarkerDataUrl(vehicleColor(v))
          : moving
            ? headingArrowDataUrl(vehicleColor(v), v.heading)
            : markerDataUrl(vehicleColor(v));
        el.alt = v.label;
        el.style.cursor = 'pointer';
        el.style.width = isSel ? '30px' : '24px';
        el.style.height = isSel ? '30px' : '24px';

        const popup = new MaplibrePopup({ offset: 14, closeButton: false }).setHTML(
          `<div style="font-weight:600">${v.label}</div>` +
            `<div style="color:#64748B;font-size:11px">${v.driver ? `${v.driver} · ` : ''}${v.speed} km/h · ${ageLabel(v.updatedAt, t)}</div>`,
        );
        const marker = new MaplibreMarker({ element: el, anchor: 'center' })
          .setLngLat([v.lng, v.lat])
          .setPopup(popup);
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          onSelectRef.current?.(v.id);
        });
        marker.addTo(map);
        return marker;
      });
    };

    if (map.loaded()) sync();
    else map.once('load', sync);

    // When not paused, re-cluster on pan/zoom so the viewport reflects the fleet.
    if (paused) return;
    const onMove = () => sync();
    map.on('moveend', onMove);
    return () => {
      map.off('moveend', onMove);
    };
  }, [vehicles, selectedId, paused, t]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
