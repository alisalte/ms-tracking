import { afterEach, describe, expect, it } from 'vitest';

import {
  BASEMAPS,
  DEFAULT_BASEMAP,
  basemapTiles,
  isBasemapId,
  loadPersistedBasemap,
  persistBasemap,
  rasterMapStyle,
} from '@/lib/basemaps';

describe('basemaps', () => {
  afterEach(() => {
    localStorage.removeItem('fv:map-basemap');
  });
  it('defaults to Google Streets', () => {
    expect(DEFAULT_BASEMAP).toBe('google');
    expect(BASEMAPS.filter((b) => b.group === 'google')).toHaveLength(4);
    expect(BASEMAPS.filter((b) => b.group === 'other')).toHaveLength(4);
  });

  it('builds Google raster URLs with the UI language', () => {
    const google = BASEMAPS.find((b) => b.id === 'google');
    expect(google).toBeDefined();
    const fa = basemapTiles(google!, 'fa');
    expect(fa).toHaveLength(4);
    expect(fa[0]).toContain('mt0.google.com/vt/lyrs=m');
    expect(fa[0]).toContain('hl=fa');
    expect(fa[0]).toContain('{x}');
    const en = basemapTiles(google!, 'en');
    expect(en[0]).toContain('hl=en');
  });

  it('keeps OSM / Esri tiles as switchable alternatives', () => {
    const osm = BASEMAPS.find((b) => b.id === 'streets');
    expect(basemapTiles(osm!)).toEqual(['https://tile.openstreetmap.org/{z}/{x}/{y}.png']);
  });

  it('persists and restores the operator choice', () => {
    persistBasemap('google-hybrid');
    expect(loadPersistedBasemap()).toBe('google-hybrid');
    persistBasemap('streets');
    expect(loadPersistedBasemap()).toBe('streets');
    expect(isBasemapId('nope')).toBe(false);
  });

  it('emits a MapLibre raster style with a single basemap source', () => {
    const style = rasterMapStyle('google-satellite', 'fa');
    expect(style.sources.basemap.type).toBe('raster');
    expect(style.sources.basemap.tiles[0]).toContain('lyrs=s');
    expect(style.sources.basemap.maxzoom).toBe(21);
    expect(style.layers[0]?.id).toBe('basemap');
  });

  it('caps native zoom so MapLibre overzooms instead of fetching missing z=22 tiles', () => {
    expect(BASEMAPS.find((b) => b.id === 'google')?.maxzoom).toBe(21);
    expect(BASEMAPS.find((b) => b.id === 'streets')?.maxzoom).toBe(19);
    expect(rasterMapStyle('streets').sources.basemap.maxzoom).toBe(19);
  });
});
