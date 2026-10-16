/**
 * Persist the live-map camera so basemap remounts / page reloads keep the
 * operator's current zoom and center ("این زوم").
 */
export const MAP_CAMERA_STORAGE_KEY = 'fv:map-camera';

export interface MapCamera {
  readonly lng: number;
  readonly lat: number;
  readonly zoom: number;
}

/** Tehran-ish default — matches the historic FleetMap bootstrap. */
export const DEFAULT_MAP_CAMERA: MapCamera = {
  lng: 51.338,
  lat: 35.719,
  zoom: 11,
};

export function isValidCamera(value: unknown): value is MapCamera {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.lng === 'number' &&
    Number.isFinite(v.lng) &&
    typeof v.lat === 'number' &&
    Number.isFinite(v.lat) &&
    typeof v.zoom === 'number' &&
    Number.isFinite(v.zoom) &&
    v.zoom >= 0 &&
    v.zoom <= 22
  );
}

export function loadPersistedMapCamera(): MapCamera {
  try {
    const raw = localStorage.getItem(MAP_CAMERA_STORAGE_KEY);
    if (!raw) return DEFAULT_MAP_CAMERA;
    const parsed: unknown = JSON.parse(raw);
    return isValidCamera(parsed) ? parsed : DEFAULT_MAP_CAMERA;
  } catch {
    return DEFAULT_MAP_CAMERA;
  }
}

export function persistMapCamera(camera: MapCamera): void {
  if (!isValidCamera(camera)) return;
  try {
    localStorage.setItem(MAP_CAMERA_STORAGE_KEY, JSON.stringify(camera));
  } catch {
    // Private-mode storage etc. — persistence is best-effort.
  }
}
