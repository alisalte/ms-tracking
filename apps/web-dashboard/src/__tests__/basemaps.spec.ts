import { afterEach, describe, expect, it } from 'vitest';

import {
  BASEMAPS,
  DEFAULT_BASEMAP,
  applyRasterBasemap,
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

  it('swaps raster tiles via setTiles without tearing down overlay layers', () => {
    const calls: string[] = [];
    let tiles = ['https://mt0.google.com/vt/lyrs=m&hl=en&x={x}&y={y}&z={z}'];
    const source = {
      tiles,
      maxzoom: 21,
      _options: { maxzoom: 21, attribution: '© Google', tiles },
      setTiles(next: string[]) {
        tiles = next;
        this.tiles = next;
        calls.push(`setTiles:${next[0]}`);
      },
      setSourceProperty(cb: () => void) {
        cb();
        calls.push('setSourceProperty');
      },
    };
    const layers = new Map<string, true>([
      ['basemap', true],
      ['geofence-fill', true],
    ]);
    const map = {
      getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
      getSource: (id: string) => (id === 'basemap' ? source : undefined),
      getCenter: () => ({ lng: 51.3, lat: 35.7 }),
      getZoom: () => 14,
      getBearing: () => 0,
      getPitch: () => 0,
      jumpTo: (v: { zoom: number }) => {
        calls.push(`jumpTo:${v.zoom}`);
      },
      removeLayer: () => {
        calls.push('removeLayer');
      },
      removeSource: () => {
        calls.push('removeSource');
      },
      addSource: () => {
        calls.push('addSource');
      },
      addLayer: () => {
        calls.push('addLayer');
      },
      triggerRepaint: () => {
        calls.push('repaint');
      },
    };
    applyRasterBasemap(map as never, 'streets', 'en', ['geofence-fill']);
    expect(calls.some((c) => c.startsWith('setTiles:') && c.includes('openstreetmap'))).toBe(true);
    expect(calls).toContain('setSourceProperty');
    expect(calls).toContain('jumpTo:14');
    expect(calls).toContain('repaint');
    expect(calls).not.toContain('removeLayer');
    expect(source.maxzoom).toBe(19);
  });

  it('falls back to remove+re-add when the basemap source is missing', () => {
    const removed: string[] = [];
    const added: Array<{ id: string; tiles?: string[]; maxzoom?: number }> = [];
    const layers = new Map<string, true>([['geofence-fill', true]]);
    const sources = new Map<string, true>();
    const map = {
      getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
      getSource: (id: string) => (sources.has(id) ? { id } : undefined),
      getCenter: () => ({ lng: 51.3, lat: 35.7 }),
      getZoom: () => 12,
      getBearing: () => 0,
      getPitch: () => 0,
      jumpTo: () => undefined,
      removeLayer: (id: string) => {
        removed.push(`layer:${id}`);
        layers.delete(id);
      },
      removeSource: (id: string) => {
        removed.push(`source:${id}`);
        sources.delete(id);
      },
      addSource: (id: string, src: { tiles: string[]; maxzoom: number }) => {
        sources.set(id, true);
        added.push({ id, tiles: src.tiles, maxzoom: src.maxzoom });
      },
      addLayer: (layer: { id: string }, before?: string) => {
        layers.set(layer.id, true);
        added.push({ id: `layer:${layer.id}${before ? `:${before}` : ''}` });
      },
      triggerRepaint: () => {
        added.push({ id: 'repaint' });
      },
    };
    applyRasterBasemap(map as never, 'streets', 'en', ['geofence-fill']);
    expect(removed).toEqual([]);
    expect(added[0]?.tiles?.[0]).toContain('tile.openstreetmap.org');
    expect(added[0]?.maxzoom).toBe(19);
    expect(added.some((a) => a.id === 'layer:basemap:geofence-fill')).toBe(true);
  });
});
