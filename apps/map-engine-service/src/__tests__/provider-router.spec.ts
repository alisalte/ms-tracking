import { describe, expect, it } from '@jest/globals';
import { ProviderRouter } from '../application/provider-router.js';
import type { MapProvider } from '../domain/map-provider.js';

/** A minimal fake provider for testing the router. */
function fakeProvider(name: string): MapProvider {
  return {
    name,
    geocode: async () => [],
    reverseGeocode: async () => null,
    route: async () => ({
      distanceKm: 0,
      durationSec: 0,
      geometry: [],
      mode: 'static',
      provider: name,
    }),
    matchRoute: async () => [],
    snapPoint: async () => ({
      latitude: 0,
      longitude: 0,
      roadName: null,
      postedLimitKmh: null,
      confidence: 0,
      provider: name,
    }),
    searchPlaces: async () => [],
  };
}

describe('ProviderRouter (08 §2.3)', () => {
  it('selects the default provider when no region override applies', () => {
    const local = fakeProvider('local');
    const router = new ProviderRouter({
      providers: new Map([['local', local]]),
      defaultProvider: 'local',
      region: 'global',
    });
    expect(router.select().name).toBe('local');
  });

  it('selects the amap provider when region is china and amap is configured', () => {
    const local = fakeProvider('local');
    const amap = fakeProvider('amap');
    const router = new ProviderRouter({
      providers: new Map([
        ['local', local],
        ['amap', amap],
      ]),
      defaultProvider: 'local',
      region: 'china',
    });
    expect(router.select().name).toBe('amap');
  });

  it('falls back to default when region is china but amap is not configured', () => {
    const local = fakeProvider('local');
    const router = new ProviderRouter({
      providers: new Map([['local', local]]),
      defaultProvider: 'local',
      region: 'china',
    });
    expect(router.select().name).toBe('local');
  });

  it('throws when the default provider is not configured', () => {
    const router = new ProviderRouter({
      providers: new Map(),
      defaultProvider: 'nonexistent',
      region: 'global',
    });
    expect(() => router.select()).toThrow(/not configured/);
  });
});
