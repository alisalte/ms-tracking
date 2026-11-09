/**
 * Draws the organisation's drone orthophoto directly above the basemap (under
 * every other overlay) on any MapLibre surface. Outside the flown area the
 * tiles are transparent, so the chosen basemap keeps showing.
 */
import type { Map as MaplibreMap, RasterSourceSpecification } from 'maplibre-gl';
import { type RefObject, useCallback, useEffect, useState } from 'react';

import { ORTHOPHOTO_CHANGE_EVENT, type Orthophoto, fetchOrthophotos } from '@/api/orthophoto.api';

const LAYER_ID = 'orthophoto';
const VISIBLE_KEY = 'fv:map-orthophoto-visible';
const VISIBLE_EVENT = 'fv:orthophoto-visible';
/** Tile tokens last at least a day; refreshing hourly keeps open screens valid. */
const REFRESH_MS = 60 * 60 * 1000;

function readVisible(): boolean {
  try {
    return localStorage.getItem(VISIBLE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function useOrthophotoVisible(): [boolean, (visible: boolean) => void] {
  const [visible, setVisible] = useState(readVisible);
  useEffect(() => {
    const sync = () => setVisible(readVisible());
    window.addEventListener(VISIBLE_EVENT, sync);
    return () => window.removeEventListener(VISIBLE_EVENT, sync);
  }, []);
  const change = useCallback((next: boolean) => {
    try {
      localStorage.setItem(VISIBLE_KEY, next ? '1' : '0');
    } catch {
      // Best-effort persistence.
    }
    window.dispatchEvent(new Event(VISIBLE_EVENT));
  }, []);
  return [visible, change];
}

export function useActiveOrthophoto(): Orthophoto | null {
  const [active, setActive] = useState<Orthophoto | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchOrthophotos()
        .then((items) => {
          if (!cancelled) setActive(items.find((o) => o.status === 'ready' && o.tileUrl) ?? null);
        })
        .catch(() => {
          // No maps.read or API down: the map simply has no drone layer.
        });
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    window.addEventListener(ORTHOPHOTO_CHANGE_EVENT, load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(ORTHOPHOTO_CHANGE_EVENT, load);
    };
  }, []);
  return active;
}

function clearLayer(map: MaplibreMap) {
  if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
  if (map.getSource(LAYER_ID)) map.removeSource(LAYER_ID);
}

/** Idempotent: safe to call on every style change. */
function syncLayer(map: MaplibreMap, ortho: Orthophoto | null, visible: boolean, tiles: string) {
  if (!ortho || !visible) {
    clearLayer(map);
    return;
  }
  const current = map.getSource(LAYER_ID) as { tiles?: string[] } | undefined;
  if (current && current.tiles?.[0] !== tiles) clearLayer(map);
  if (!map.getSource(LAYER_ID)) {
    const source: RasterSourceSpecification = {
      type: 'raster',
      tiles: [tiles],
      tileSize: 256,
      minzoom: ortho.minZoom ?? 0,
      maxzoom: ortho.maxZoom ?? 22,
      ...(ortho.bounds ? { bounds: ortho.bounds } : {}),
    };
    map.addSource(LAYER_ID, source);
  }
  const ids = (map.getStyle().layers ?? []).map((l) => l.id).filter((id) => id !== LAYER_ID);
  const before = ids[ids.indexOf('basemap') + 1];
  if (!map.getLayer(LAYER_ID)) {
    map.addLayer({ id: LAYER_ID, type: 'raster', source: LAYER_ID }, before);
    return;
  }
  const order = (map.getStyle().layers ?? []).map((l) => l.id);
  if (order[order.indexOf('basemap') + 1] !== LAYER_ID) map.moveLayer(LAYER_ID, before);
}

export function useOrthophotoOverlay(
  mapRef: RefObject<MaplibreMap | null>,
  mapReady: boolean,
  basemap: string,
): void {
  const ortho = useActiveOrthophoto();
  const [visible] = useOrthophotoVisible();

  // `basemap` is a dependency because a basemap swap can re-add its layer on top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const tiles = ortho?.tileUrl ? `${window.location.origin}${ortho.tileUrl}` : '';
    const apply = () => {
      try {
        if (map.getStyle()) syncLayer(map, ortho, visible, tiles);
      } catch {
        // Style still loading; the next idle event retries.
      }
    };
    apply();
    map.on('idle', apply);
    return () => {
      map.off('idle', apply);
    };
  }, [mapRef, mapReady, ortho, visible, basemap]);
}
