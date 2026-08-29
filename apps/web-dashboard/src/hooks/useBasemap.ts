import type { Map as MaplibreMap } from 'maplibre-gl';
/**
 * Shared basemap choice — persisted per browser, synced across maps in this tab.
 */
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  BASEMAP_CHANGE_EVENT,
  BASEMAP_STORAGE_KEY,
  type BasemapId,
  applyRasterBasemap,
  isBasemapId,
  loadPersistedBasemap,
  persistBasemap,
} from '@/lib/basemaps';
import { runWhenStyleReady } from '@/lib/map-ready';

/** Stable empty overlay list — do not pass `[]` inline (new array every render). */
export const NO_OVERLAY_LAYERS: readonly string[] = [];

export function useBasemap(): [BasemapId, (id: BasemapId) => void] {
  const [basemap, setBasemap] = useState<BasemapId>(loadPersistedBasemap);

  useEffect(() => {
    const onCustom = (event: Event) => {
      const id = (event as CustomEvent<BasemapId>).detail;
      if (isBasemapId(id)) setBasemap(id);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === BASEMAP_STORAGE_KEY && isBasemapId(event.newValue)) {
        setBasemap(event.newValue);
      }
    };
    window.addEventListener(BASEMAP_CHANGE_EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(BASEMAP_CHANGE_EVENT, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const change = useCallback((id: BasemapId) => {
    setBasemap(id);
    persistBasemap(id);
  }, []);

  return [basemap, change];
}

/**
 * Keep a MapLibre instance on the shared basemap (and UI language for Google
 * labels). Call after the map is created with `rasterMapStyle(...)`.
 */
export function useFollowBasemap(
  mapRef: RefObject<MaplibreMap | null>,
  beforeLayerIds: readonly string[] = NO_OVERLAY_LAYERS,
  mapReady = true,
): { basemap: BasemapId; setBasemap: (id: BasemapId) => void } {
  const { i18n } = useTranslation();
  const [basemap, setBasemap] = useBasemap();
  const appliedRef = useRef('');

  useEffect(() => {
    if (!mapReady) {
      appliedRef.current = '';
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    const key = `${basemap}|${i18n.language}`;
    if (appliedRef.current === key) return;
    let cancelled = false;
    const swap = () => {
      if (cancelled || mapRef.current !== map) return;
      applyRasterBasemap(map, basemap, i18n.language, beforeLayerIds);
      appliedRef.current = key;
    };
    runWhenStyleReady(map, swap);
    return () => {
      cancelled = true;
    };
  }, [basemap, beforeLayerIds, i18n.language, mapReady, mapRef]);

  return { basemap, setBasemap };
}
