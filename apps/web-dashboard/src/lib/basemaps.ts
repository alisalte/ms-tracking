/**
 * Basemap catalog for every MapLibre surface (live map, geofences, trips,
 * alarms, dashboard preview).
 *
 * All styles are raster tiles so the map keeps ONE `basemap` source/layer and
 * swaps URLs in place — vehicle / cluster / draw markers are DOM-based and
 * survive the switch. Choice is persisted in localStorage and synced across
 * mounted maps in the same tab via `fv:basemap-change`.
 *
 * Google styles use Google's public raster endpoints (labels follow the UI
 * language). Raster `maxzoom` is capped at 21 because Google has no z=22
 * tiles — MapLibre's default is 22, those requests 404 as HTML without CORS,
 * and the console fills with `AJAXError: Failed to fetch`. OSM / Esri /
 * OpenTopo stay available so the operator can flip back from Map settings.
 */
import type { Map as MaplibreMap } from 'maplibre-gl';

export type BasemapId =
  | 'google'
  | 'google-satellite'
  | 'google-hybrid'
  | 'google-terrain'
  | 'streets'
  | 'satellite'
  | 'dark'
  | 'topo';

export type BasemapGroup = 'google' | 'other';

export interface BasemapDef {
  readonly id: BasemapId;
  readonly group: BasemapGroup;
  /** i18n key under `map.basemap.<id>` (hyphens stripped for nested keys). */
  readonly labelKey: string;
  readonly attribution: string;
  /** Tailwind gradient used for the settings-panel swatch. */
  readonly swatchClass: string;
  /** Google `lyrs` code — tiles are built per UI language. */
  readonly googleLyrs?: 'm' | 's' | 'y' | 'p';
  /** Static tile URL templates (non-Google providers). */
  readonly tiles?: readonly string[];
  /**
   * Native raster zoom. MapLibre overzooms past this instead of requesting
   * missing tiles. Unset → MapLibre default 22, which 404s on Google/OSM.
   */
  readonly maxzoom: number;
}

export const BASEMAP_STORAGE_KEY = 'fv:map-basemap';
export const BASEMAP_CHANGE_EVENT = 'fv:basemap-change';

export const BASEMAPS: readonly BasemapDef[] = [
  {
    id: 'google',
    group: 'google',
    labelKey: 'map.basemap.google',
    attribution: '© Google',
    swatchClass: 'from-sky-300 via-emerald-200 to-amber-200',
    googleLyrs: 'm',
    maxzoom: 21,
  },
  {
    id: 'google-satellite',
    group: 'google',
    labelKey: 'map.basemap.googleSatellite',
    attribution: '© Google',
    swatchClass: 'from-slate-600 to-slate-900',
    googleLyrs: 's',
    maxzoom: 21,
  },
  {
    id: 'google-hybrid',
    group: 'google',
    labelKey: 'map.basemap.googleHybrid',
    attribution: '© Google',
    swatchClass: 'from-emerald-900 to-slate-700',
    googleLyrs: 'y',
    maxzoom: 21,
  },
  {
    id: 'google-terrain',
    group: 'google',
    labelKey: 'map.basemap.googleTerrain',
    attribution: '© Google',
    swatchClass: 'from-lime-200 to-amber-400',
    googleLyrs: 'p',
    maxzoom: 21,
  },
  {
    id: 'streets',
    group: 'other',
    labelKey: 'map.basemap.streets',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: '© OpenStreetMap contributors',
    swatchClass: 'from-emerald-200 to-emerald-400',
    maxzoom: 19,
  },
  {
    id: 'satellite',
    group: 'other',
    labelKey: 'map.basemap.satellite',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: '© Esri, Maxar, Earthstar Geographics',
    swatchClass: 'from-slate-600 to-slate-800',
    maxzoom: 19,
  },
  {
    id: 'dark',
    group: 'other',
    labelKey: 'map.basemap.dark',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: '© Esri, HERE, Garmin, OpenStreetMap contributors',
    swatchClass: 'from-gray-700 to-gray-900',
    maxzoom: 16,
  },
  {
    id: 'topo',
    group: 'other',
    labelKey: 'map.basemap.topo',
    tiles: [
      'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
    ],
    attribution: '© OpenTopoMap (CC-BY-SA)',
    swatchClass: 'from-amber-200 to-amber-500',
    maxzoom: 17,
  },
];

export const DEFAULT_BASEMAP: BasemapId = 'google';

export function isBasemapId(value: string | null | undefined): value is BasemapId {
  return BASEMAPS.some((b) => b.id === value);
}

export function basemapById(id: BasemapId): BasemapDef {
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];
}

export function basemapLabelKey(id: BasemapId): string {
  return basemapById(id).labelKey;
}

function tileLang(lang?: string): 'fa' | 'en' {
  return lang?.toLowerCase().startsWith('fa') ? 'fa' : 'en';
}

/** Raster tile URLs for a catalog entry (Google URLs include UI language). */
export function basemapTiles(def: BasemapDef, lang?: string): string[] {
  if (def.googleLyrs) {
    const hl = tileLang(lang);
    return [0, 1, 2, 3].map(
      (i) => `https://mt${i}.google.com/vt/lyrs=${def.googleLyrs}&hl=${hl}&x={x}&y={y}&z={z}`,
    );
  }
  return [...(def.tiles ?? [])];
}

function rasterSource(bm: BasemapDef, lang?: string) {
  return {
    type: 'raster' as const,
    tiles: basemapTiles(bm, lang),
    tileSize: 256,
    attribution: bm.attribution,
    maxzoom: bm.maxzoom,
  };
}

export function rasterMapStyle(id: BasemapId, lang?: string) {
  const bm = basemapById(id);
  return {
    version: 8 as const,
    sources: {
      basemap: rasterSource(bm, lang),
    },
    layers: [{ id: 'basemap', type: 'raster' as const, source: 'basemap' }],
  };
}

/**
 * Swap the live `basemap` raster source. Prefers `setTiles` so overlay layers
 * (geofences, tracks, draw fill) keep their order; falls back to re-adding
 * the raster layer beneath the first existing overlay id.
 */
export function applyRasterBasemap(
  map: MaplibreMap,
  id: BasemapId,
  lang?: string,
  beforeLayerIds: readonly string[] = [],
): void {
  const bm = basemapById(id);
  const source = rasterSource(bm, lang);
  const existing = map.getSource('basemap') as
    | { setTiles?: (next: string[]) => void; attribution?: string; maxzoom?: number }
    | undefined;
  if (existing && typeof existing.setTiles === 'function') {
    existing.setTiles(source.tiles);
    existing.attribution = source.attribution;
    existing.maxzoom = source.maxzoom;
    return;
  }
  if (map.getLayer('basemap')) map.removeLayer('basemap');
  if (map.getSource('basemap')) map.removeSource('basemap');
  map.addSource('basemap', source);
  const before = beforeLayerIds.find((layerId) => map.getLayer(layerId));
  map.addLayer({ id: 'basemap', type: 'raster', source: 'basemap' }, before);
}

/** Restore the persisted basemap choice (invalid values fall back). */
export function loadPersistedBasemap(): BasemapId {
  try {
    const saved = localStorage.getItem(BASEMAP_STORAGE_KEY);
    return isBasemapId(saved) ? saved : DEFAULT_BASEMAP;
  } catch {
    return DEFAULT_BASEMAP;
  }
}

export function persistBasemap(id: BasemapId): void {
  try {
    localStorage.setItem(BASEMAP_STORAGE_KEY, id);
  } catch {
    // Private-mode storage etc. — persistence is best-effort.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(BASEMAP_CHANGE_EVENT, { detail: id }));
  }
}
