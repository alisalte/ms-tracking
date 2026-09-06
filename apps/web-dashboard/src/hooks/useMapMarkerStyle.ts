import { useCallback, useEffect, useState } from 'react';

import {
  MAP_MARKER_STYLE_CHANGE_EVENT,
  MAP_MARKER_STYLE_STORAGE_KEY,
  type MapMarkerStyle,
  isMapMarkerStyle,
  loadPersistedMapMarkerStyle,
  persistMapMarkerStyle,
} from '@/lib/map-marker-style';

/** Shared map-marker chrome — persisted per browser, synced across maps. */
export function useMapMarkerStyle(): [MapMarkerStyle, (style: MapMarkerStyle) => void] {
  const [style, setStyle] = useState<MapMarkerStyle>(loadPersistedMapMarkerStyle);

  useEffect(() => {
    const onCustom = (event: Event) => {
      const next = (event as CustomEvent<MapMarkerStyle>).detail;
      if (isMapMarkerStyle(next)) setStyle(next);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === MAP_MARKER_STYLE_STORAGE_KEY && isMapMarkerStyle(event.newValue)) {
        setStyle(event.newValue);
      }
    };
    window.addEventListener(MAP_MARKER_STYLE_CHANGE_EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(MAP_MARKER_STYLE_CHANGE_EVENT, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const change = useCallback((next: MapMarkerStyle) => {
    setStyle(next);
    persistMapMarkerStyle(next);
  }, []);

  return [style, change];
}
