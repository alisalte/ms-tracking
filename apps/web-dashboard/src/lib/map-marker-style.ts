import { readPrefCookie, writePrefCookie } from '@/lib/pref-cookie';

/**
 * Live-map marker chrome: photorealistic vehicle body vs a simple colored
 * navigation arrow. Persisted in a cookie (and localStorage) so the next visit
 * keeps the same icon.
 */
export const MAP_MARKER_STYLES = ['vehicle', 'navigation'] as const;
export type MapMarkerStyle = (typeof MAP_MARKER_STYLES)[number];

export const DEFAULT_MAP_MARKER_STYLE: MapMarkerStyle = 'vehicle';
export const MAP_MARKER_STYLE_STORAGE_KEY = 'fv:map-marker-style';
/** Cookie names cannot include `:`; keep this stable across releases. */
export const MAP_MARKER_STYLE_COOKIE_KEY = 'fv-map-marker-style';
export const MAP_MARKER_STYLE_CHANGE_EVENT = 'fv:marker-style-change';

export function isMapMarkerStyle(value: string | null | undefined): value is MapMarkerStyle {
  return value === 'vehicle' || value === 'navigation';
}

function remember(style: MapMarkerStyle): void {
  writePrefCookie(MAP_MARKER_STYLE_COOKIE_KEY, style);
  try {
    localStorage.setItem(MAP_MARKER_STYLE_STORAGE_KEY, style);
  } catch {
    // Private-mode storage etc. — cookie is the durable copy.
  }
}

export function loadPersistedMapMarkerStyle(): MapMarkerStyle {
  try {
    const fromCookie = readPrefCookie(MAP_MARKER_STYLE_COOKIE_KEY);
    if (isMapMarkerStyle(fromCookie)) return fromCookie;
    const saved = localStorage.getItem(MAP_MARKER_STYLE_STORAGE_KEY);
    if (isMapMarkerStyle(saved)) {
      writePrefCookie(MAP_MARKER_STYLE_COOKIE_KEY, saved);
      return saved;
    }
  } catch {
    // Storage / cookie blocked.
  }
  return DEFAULT_MAP_MARKER_STYLE;
}

export function persistMapMarkerStyle(style: MapMarkerStyle): void {
  remember(style);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MAP_MARKER_STYLE_CHANGE_EVENT, { detail: style }));
  }
}
