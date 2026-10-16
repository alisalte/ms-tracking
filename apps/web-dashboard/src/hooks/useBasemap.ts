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
 *
 * Pass `controlled` when the parent (e.g. MapPage settings) owns the choice —
 * that forces an in-place tile swap on every click, not only via the storage
 * event (which can miss same-tab updates if the map hook was late to subscribe).
 */
export function useFollowBasemap(
  mapRef: RefObject<MaplibreMap | null>,
  beforeLayerIds: readonly string[] = NO_OVERLAY_LAYERS,
  mapReady = true,
  controlled?: BasemapId | null,
): { basemap: BasemapId; setBasemap: (id: BasemapId) => void } {
  const { i18n } = useTranslation();
  const [basemap, setBasemap] = useBasemap();
  const active = controlled ?? basemap;
  const appliedRef = useRef('');

  useEffect(() => {
    if (!mapReady) {
      appliedRef.current = '';
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    const key = `${active}|${i18n.language}`;
    if (appliedRef.current === key) return;

    let cancelled = false;
    const tryApply = (): boolean => {
      if (cancelled || mapRef.current !== map) return false;
      try {
        // Style must accept source mutations; idle/styledata retries cover the gap.
        if (!(map.isStyleLoaded() || map.loaded())) return false;
        applyRasterBasemap(map, active, i18n.language, beforeLayerIds);
        appliedRef.current = key;
        return true;
      } catch {
        appliedRef.current = '';
        return false;
      }
    };

    if (tryApply()) {
      return () => {
        cancelled = true;
      };
    }

    const onRetry = () => {
      if (appliedRef.current === key || cancelled) return;
      tryApply();
    };
    map.on('idle', onRetry);
    map.on('styledata', onRetry);
    const t0 = window.setTimeout(onRetry, 0);
    const t1 = window.setTimeout(onRetry, 50);
    const t2 = window.setTimeout(onRetry, 200);

    return () => {
      cancelled = true;
      map.off('idle', onRetry);
      map.off('styledata', onRetry);
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [active, beforeLayerIds, i18n.language, mapReady, mapRef]);

  return { basemap: active, setBasemap };
}
