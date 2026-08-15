import type { TFunction } from 'i18next';
import {
  type GeoJSONSource,
  LngLatBounds,
  Map as MaplibreMap,
  Marker as MaplibreMarker,
  Popup as MaplibrePopup,
} from 'maplibre-gl';
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

/** A prepared historical track (already gap-split by track-utils). */
export interface HistoryTrack {
  /** Polyline segments in GeoJSON [lng, lat] order (gaps are NOT bridged). */
  readonly segments: ReadonlyArray<ReadonlyArray<[number, number]>>;
  /** Bump to re-fit the camera onto the track. */
  readonly key: number;
}

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
  /**
   * §17 selection sync: selecting a list row focuses the map. Each token change
   * flies to the referenced vehicle (nonce bumped per request so re-selecting
   * the same vehicle re-focuses).
   */
  focus?: { id: string; nonce: number } | null;
  /** Historical track overlay (Sprint F §9) — null in live mode. */
  track?: HistoryTrack | null;
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

/** Icon identity: rebuild the marker image only when this changes. */
function iconKey(v: MapVehicle, selected: boolean): string {
  const moving = v.state === 'driving' || v.state === 'overspeed';
  return `${vehicleColor(v)}|${selected ? 'sel' : moving ? `h${Math.round(v.heading / 5) * 5}` : 'dot'}`;
}

/**
 * FleetMap — the full-bleed real-time map for the Live Tracking page.
 *
 * UI_UX_Design.md §2.2–§2.7: free OSM raster tiles via MapLibre GL, vehicle
 * markers colored by status (cyan/yellow/rose/slate) and rotated to heading,
 * client-side clustering with `supercluster` (count bubbles, click → zoom in),
 * hover tooltip, and a selection highlight. Markers are managed imperatively
 * (create/update/remove via MapLibre, tracked in a ref) exactly like the
 * dashboard preview — that pattern is proven and avoids React reconciliation
 * cost.
 *
 * Sprint F §7/§27: vehicle markers are DIFFED by id — a live position delta
 * moves the existing marker (`setLngLat`) and only rebuilds the icon when its
 * visual identity changes; the map itself is never recreated. Sprint F §9:
 * the optional `track` overlay renders a gap-aware MultiLineString polyline.
 */
export function FleetMap({
  vehicles,
  selectedId,
  onSelect,
  onDeselect,
  paused = false,
  focus = null,
  track = null,
}: FleetMapProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  /** Keyed vehicle markers (id → marker + rendered icon identity). */
  const vehicleMarkersRef = useRef(
    new Map<string, { marker: MaplibreMarker; el: HTMLElement; key: string }>(),
  );
  /** Cluster markers (churn by nature — rebuilt per sync). */
  const clusterMarkersRef = useRef<MaplibreMarker[]>([]);

  // The latest fleet for the focus effect (which must not re-run on data change).
  const vehiclesRef = useRef(vehicles);
  vehiclesRef.current = vehicles;

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
      for (const m of vehicleMarkersRef.current.values()) m.marker.remove();
      vehicleMarkersRef.current.clear();
      for (const m of clusterMarkersRef.current) m.remove();
      clusterMarkersRef.current = [];
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

      // Clusters churn per viewport — rebuild them wholesale.
      for (const m of clusterMarkersRef.current) m.remove();
      clusterMarkersRef.current = features
        .filter((f): f is Extract<typeof f, { kind: 'cluster' }> => f.kind === 'cluster')
        .map((feat) => {
          const el = document.createElement('img');
          el.className = 'fv-vehicle-marker';
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
        })
        .filter((m): m is MaplibreMarker => m !== null);

      // Vehicle markers are DIFFED by id (Sprint F §7/§27): existing markers
      // move in place; only new/changed-icon markers rebuild. A live delta for
      // one vehicle therefore touches one marker — not the whole fleet.
      const seen = new Set<string>();
      for (const feat of features) {
        if (feat.kind !== 'point') continue;
        const v = feat.vehicle;
        seen.add(v.id);
        const key = iconKey(v, v.id === selectedId);
        const existing = vehicleMarkersRef.current.get(v.id);
        if (existing) {
          existing.marker.setLngLat([v.lng, v.lat]);
          if (existing.key !== key) {
            applyVehicleIcon(existing.el, v, v.id === selectedId);
            existing.key = key;
          }
          continue;
        }
        const el = document.createElement('img');
        el.className = 'fv-vehicle-marker';
        applyVehicleIcon(el, v, v.id === selectedId);
        el.alt = v.label;
        el.style.cursor = 'pointer';
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
        vehicleMarkersRef.current.set(v.id, { marker, el, key });
      }
      // Remove markers that left the viewport/fleet.
      for (const [id, entry] of vehicleMarkersRef.current) {
        if (!seen.has(id)) {
          entry.marker.remove();
          vehicleMarkersRef.current.delete(id);
        }
      }
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

  // Historical track overlay (Sprint F §9): gap-aware MultiLineString.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const render = () => {
      // GeoJSON types require mutable Position[][] — copy out of the readonly view.
      const data: { type: 'MultiLineString'; coordinates: number[][][] } = {
        type: 'MultiLineString',
        coordinates:
          track && track.segments.length > 0
            ? track.segments.map((seg) => seg.map(([lng, lat]) => [lng, lat]))
            : [],
      };
      const source = map.getSource('history-track');
      if (source && source.type === 'geojson') {
        (source as GeoJSONSource).setData(data);
      } else if (track && track.segments.length > 0) {
        map.addSource('history-track', { type: 'geojson', data });
        map.addLayer({
          id: 'history-track-line',
          type: 'line',
          source: 'history-track',
          paint: {
            'line-color': mapAccents.selectedRoute,
            'line-width': 3,
          },
          layout: { 'line-join': 'round', 'line-cap': 'round' },
        });
      }

      // Fit the camera onto the freshly loaded track.
      if (track && track.segments.length > 0) {
        let west = Number.POSITIVE_INFINITY;
        let south = Number.POSITIVE_INFINITY;
        let east = Number.NEGATIVE_INFINITY;
        let north = Number.NEGATIVE_INFINITY;
        for (const seg of track.segments) {
          for (const [lng, lat] of seg) {
            if (lng < west) west = lng;
            if (lng > east) east = lng;
            if (lat < south) south = lat;
            if (lat > north) north = lat;
          }
        }
        if (Number.isFinite(west)) {
          map.fitBounds(new LngLatBounds([west, south], [east, north]), {
            padding: 60,
            maxZoom: 15,
            duration: 600,
          });
        }
      }
    };

    if (map.loaded()) render();
    else map.once('load', render);
  }, [track]);

  // §17 selection sync: a list-row selection flies the camera to the vehicle.
  // Depends only on the focus token so live position deltas never re-trigger it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    const v = vehiclesRef.current.find((veh) => veh.id === focus.id);
    if (!v || (v.lat === 0 && v.lng === 0)) return; // no fix yet — nothing to focus
    map.flyTo({ center: [v.lng, v.lat], zoom: Math.max(map.getZoom(), 14) });
  }, [focus]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}

/** Set the marker image for a vehicle (color by status, heading arrow when moving). */
function applyVehicleIcon(el: HTMLElement, v: MapVehicle, selected: boolean) {
  const moving = v.state === 'driving' || v.state === 'overspeed';
  el.setAttribute(
    'src',
    selected
      ? selectedMarkerDataUrl(vehicleColor(v))
      : moving
        ? headingArrowDataUrl(vehicleColor(v), v.heading)
        : markerDataUrl(vehicleColor(v)),
  );
  el.style.width = selected ? '30px' : '24px';
  el.style.height = selected ? '30px' : '24px';
}
