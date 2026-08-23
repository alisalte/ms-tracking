/**
 * Basemap catalog for the Live Tracking map (MapPage §"map display modes").
 *
 * All providers are keyless/free for dev use and raster-tile based, so the
 * map keeps ONE raster source/layer and just swaps its tile URLs on switch
 * (FleetMap re-adds the layer beneath the history-track overlay). Vehicle /
 * cluster markers are DOM-based and therefore survive the swap untouched.
 *
 * Provider notes:
 * - streets    OpenStreetMap standard raster.
 * - satellite  Esri World Imagery (free tier, no key; {z}/{y}/{x} order!).
 * - dark       CARTO dark_all (subdomains a–d; great for dark-mode ops rooms).
 * - topo       OpenTopoMap (contour/terrain lines; heavier style, lower zoom
 *              cache than OSM — fine for a dev stack).
 */
export type BasemapId = 'streets' | 'satellite' | 'dark' | 'topo';

export interface BasemapDef {
  readonly id: BasemapId;
  /** i18n key under `map.basemap.<id>`. */
  readonly labelKey: string;
  /** Raster tile URL templates. */
  readonly tiles: readonly string[];
  readonly attribution: string;
  /** Tailwind gradient used for the settings-panel swatch. */
  readonly swatchClass: string;
}

export const BASEMAPS: readonly BasemapDef[] = [
  {
    id: 'streets',
    labelKey: 'map.basemap.streets',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: '© OpenStreetMap contributors',
    swatchClass: 'from-emerald-200 to-emerald-400',
  },
  {
    id: 'satellite',
    labelKey: 'map.basemap.satellite',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: '© Esri, Maxar, Earthstar Geographics',
    swatchClass: 'from-slate-600 to-slate-800',
  },
  {
    id: 'dark',
    labelKey: 'map.basemap.dark',
    tiles: [
      'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
    ],
    attribution: '© OpenStreetMap contributors © CARTO',
    swatchClass: 'from-gray-700 to-gray-900',
  },
  {
    id: 'topo',
    labelKey: 'map.basemap.topo',
    tiles: [
      'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
    ],
    attribution: '© OpenTopoMap (CC-BY-SA)',
    swatchClass: 'from-amber-200 to-amber-500',
  },
];

export const DEFAULT_BASEMAP: BasemapId = 'streets';

export function basemapById(id: BasemapId): BasemapDef {
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];
}

/** Restore the persisted basemap choice (invalid values fall back). */
export function loadPersistedBasemap(): BasemapId {
  try {
    const saved = localStorage.getItem('fv:map-basemap');
    return BASEMAPS.some((b) => b.id === saved) ? (saved as BasemapId) : DEFAULT_BASEMAP;
  } catch {
    return DEFAULT_BASEMAP;
  }
}

export function persistBasemap(id: BasemapId): void {
  try {
    localStorage.setItem('fv:map-basemap', id);
  } catch {
    // Private-mode storage etc. — persistence is best-effort.
  }
}
