import type { TFunction } from 'i18next';
import {
  type GeoJSONSource,
  LngLatBounds,
  Map as MaplibreMap,
  Marker as MaplibreMarker,
  Popup as MaplibrePopup,
  NavigationControl,
} from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { circleToPolygonRing } from '@/components/geofences/GeofenceDrawMap';
import { type BasemapId, basemapById } from '@/lib/basemaps';
import { cluster, expandZoom } from '@/lib/map-cluster';
import {
  clusterMarkerDataUrl,
  headingArrowDataUrl,
  vehicleColor,
  vehicleMarkerDataUrl,
} from '@/lib/map-markers';
import { runWhenStyleReady } from '@/lib/map-ready';
import { mapAccents } from '@/theme/palette';
import type { MapVehicle } from '@/types/fleet.types';
import type { Geofence } from '@/types/geofence.types';

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
  /**
   * Playback head (Sprint I §34): animated marker position + heading. Updated
   * imperatively (setLngLat + CSS rotation) — never a map re-creation.
   */
  playbackHead?: { lat: number; lng: number; heading: number | null } | null;
  /**
   * Live follow target (vehicle id): when set and present in `vehicles`, the
   * camera pans to the vehicle on every position update. Cleared by the owner
   * (null/undefined) to stop following.
   */
  followId?: string | null;
  /**
   * Basemap style (streets / satellite / dark / topo). Switching swaps the
   * raster source's tiles in place of a full setStyle: DOM markers survive,
   * and the re-added raster layer is inserted BENEATH the history-track
   * overlay so an active track never disappears under the new tiles.
   */
  basemap?: BasemapId;
  /**
   * Active tenant geofences rendered as dashed brand outlines on the live map
   * (context for enter/exit alarms). Polygons pass through; circles are
   * converted to polygon rings.
   */
  geofences?: ReadonlyArray<Geofence>;
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
  const headingBucket = Math.round(v.heading / 5) * 5;
  return `${v.type ?? 'car'}|${vehicleColor(v)}|${selected ? 'sel' : 'n'}|h${headingBucket}`;
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
  playbackHead = null,
  followId = null,
  basemap = 'streets',
  geofences = [],
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

  /** Basemap currently applied to the map style (guards no-op swaps). */
  const appliedBasemapRef = useRef<BasemapId>('streets');

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
  // The init effect reads `basemap` for the FIRST style only; later changes
  // flow through the swap effect below (the map is never recreated).
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once by design
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const bm = basemapById(basemap);
    const map = new MaplibreMap({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: 'raster',
            tiles: [...bm.tiles],
            tileSize: 256,
            attribution: bm.attribution,
          },
        },
        layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
      },
      center: [51.338, 35.719],
      zoom: 11,
      attributionControl: { compact: true },
    });
    // Zoom + compass controls (bottom-end; CSS lifts them above the history
    // playback bar on the tracking map container).
    map.addControl(new NavigationControl({ visualizePitch: false }), 'bottom-right');
    mapRef.current = map;
    appliedBasemapRef.current = basemap;
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

  // ── Basemap switching ──
  // Swap the raster source's tiles in place of setStyle: DOM markers survive,
  // and the re-added raster layer goes UNDER the history-track overlay (when
  // one is active) so tracks never vanish beneath the new tiles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedBasemapRef.current === basemap) return;
    appliedBasemapRef.current = basemap;
    const bm = basemapById(basemap);
    const swap = () => {
      if (map.getLayer('basemap')) map.removeLayer('basemap');
      if (map.getSource('basemap')) map.removeSource('basemap');
      map.addSource('basemap', {
        type: 'raster',
        tiles: [...bm.tiles],
        tileSize: 256,
        attribution: bm.attribution,
      });
      // Insert beneath the geofence + track lines when they exist; otherwise
      // append (the vehicle/cluster markers are DOM overlays and always
      // render on top).
      map.addLayer(
        { id: 'basemap', type: 'raster', source: 'basemap' },
        map.getLayer('geofence-fill')
          ? 'geofence-fill'
          : map.getLayer('history-track-line')
            ? 'history-track-line'
            : undefined,
      );
    };
    if (map.isStyleLoaded()) {
      swap();
    } else {
      map.once('styledata', swap);
    }
  }, [basemap]);

  // ── Geofence context layer ──
  // Active tenant fences as a dashed brand outline + faint fill: operators see
  // WHY enter/exit alarms fire without leaving the live map. Circles convert
  // to polygon rings; layers sit above the basemap, beneath the history track.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const features = geofences
      .filter((g) => g.status === 'ACTIVE')
      .map((g) => {
        let ring: number[][] | null = null;
        if (g.boundaryGeoJson?.coordinates?.[0]) {
          ring = g.boundaryGeoJson.coordinates[0] as number[][];
        } else if (
          g.centerLat != null &&
          g.centerLng != null &&
          g.radiusM != null &&
          g.radiusM > 0
        ) {
          ring = circleToPolygonRing(g.centerLat, g.centerLng, g.radiusM);
        }
        return ring ? { id: g.id, name: g.name, ring } : null;
      })
      .filter((f): f is { id: string; name: string; ring: number[][] } => f !== null);

    const apply = () => {
      for (const layerId of ['geofence-fill', 'geofence-line']) {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
      }
      if (map.getSource('geofences')) map.removeSource('geofences');
      if (features.length === 0) return;
      map.addSource('geofences', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: features.map((f) => ({
            type: 'Feature' as const,
            id: f.id,
            properties: { name: f.name },
            geometry: { type: 'Polygon' as const, coordinates: [f.ring] },
          })),
        },
      });
      const before = map.getLayer('history-track-line') ? 'history-track-line' : undefined;
      map.addLayer(
        {
          id: 'geofence-fill',
          type: 'fill',
          source: 'geofences',
          paint: { 'fill-color': mapAccents.geofence, 'fill-opacity': 0.06 },
        },
        before,
      );
      map.addLayer({
        id: 'geofence-line',
        type: 'line',
        source: 'geofences',
        paint: {
          'line-color': mapAccents.geofence,
          'line-width': 1.5,
          'line-opacity': 0.75,
          'line-dasharray': [2, 2],
        },
      });
    };
    runWhenStyleReady(map, apply);
  }, [geofences]);

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
        // Colors come from the .fv-map-popup CSS (light + dark aware) — inline
        // hexes would win over the dark-mode overrides.
        const popup = new MaplibrePopup({
          offset: 14,
          closeButton: false,
          className: 'fv-map-popup',
        }).setHTML(
          `<div style="font-weight:600">${v.label}</div>` +
            `<div class="fv-map-popup-meta">${v.driver ? `${v.driver} · ` : ''}${v.speed} km/h · ${ageLabel(v.updatedAt, t)}</div>`,
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

    if (map.loaded() || map.isStyleLoaded()) sync();
    else runWhenStyleReady(map, sync);

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

    if (map.loaded() || map.isStyleLoaded()) render();
    else runWhenStyleReady(map, render);
  }, [track]);

  // Playback head marker (Sprint I §34): one marker, imperative updates only.
  const playbackMarkerRef = useRef<MaplibreMarker | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sync = () => {
      if (!playbackHead) {
        playbackMarkerRef.current?.remove();
        playbackMarkerRef.current = null;
        return;
      }
      if (!playbackMarkerRef.current) {
        const el = document.createElement('div');
        el.className = 'fv-playback-marker';
        const img = document.createElement('img');
        img.src = headingArrowDataUrl(mapAccents.vehicleOverspeed, 0);
        img.style.width = '30px';
        img.style.height = '30px';
        img.alt = '';
        el.appendChild(img);
        playbackMarkerRef.current = new MaplibreMarker({ element: el, anchor: 'center' })
          .setLngLat([playbackHead.lng, playbackHead.lat])
          .addTo(map);
        return;
      }
      // Imperative update — no source/layer rebuild, no map recreation.
      playbackMarkerRef.current.setLngLat([playbackHead.lng, playbackHead.lat]);
      const img = playbackMarkerRef.current.getElement().firstElementChild as HTMLElement | null;
      if (img) {
        img.style.transform = `rotate(${playbackHead.heading ?? 0}deg)`;
      }
    };
    if (map.loaded() || map.isStyleLoaded()) sync();
    else runWhenStyleReady(map, sync);
    return () => {
      playbackMarkerRef.current?.remove();
      playbackMarkerRef.current = null;
    };
  }, [playbackHead]);

  // §17 selection sync: a list-row selection flies the camera to the vehicle.
  // Depends only on the focus token so live position deltas never re-trigger it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    const v = vehiclesRef.current.find((veh) => veh.id === focus.id);
    if (!v || (v.lat === 0 && v.lng === 0)) return; // no fix yet — nothing to focus
    map.flyTo({ center: [v.lng, v.lat], zoom: Math.max(map.getZoom(), 14) });
  }, [focus]);

  // Live follow (§2.5 دنبال‌کردن): pan the camera to the followed vehicle on
  // every position update. Gentle `panTo` (no zoom change, animated) so the
  // operator keeps their zoom level while the marker moves under the crosshair.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !followId) return;
    const v = vehicles.find((veh) => veh.id === followId);
    if (!v || (v.lat === 0 && v.lng === 0)) return;
    const center = map.getCenter();
    // Skip when already centered (subsequent deltas re-run this effect).
    if (Math.abs(center.lng - v.lng) < 1e-5 && Math.abs(center.lat - v.lat) < 1e-5) return;
    map.panTo([v.lng, v.lat], { duration: 800 });
  }, [followId, vehicles]);

  return (
    <div ref={containerRef} className="fv-tracking-map" style={{ width: '100%', height: '100%' }} />
  );
}

/** Set the marker image: body silhouette by type, tint by status, rotate by heading. */
function applyVehicleIcon(el: HTMLElement, v: MapVehicle, selected: boolean) {
  el.setAttribute(
    'src',
    vehicleMarkerDataUrl(v.type, vehicleColor(v), {
      heading: v.heading,
      selected,
    }),
  );
  el.style.width = selected ? '48px' : '40px';
  el.style.height = selected ? '48px' : '40px';
}
