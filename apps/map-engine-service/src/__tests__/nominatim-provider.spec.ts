/**
 * Nominatim provider tests (Sprint F §28-2/3): real geocode + reverse geocode
 * against a mocked Nominatim server, Redis caching (no repeated lookups), and
 * controlled provider failures.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { RedisGeoCache } from '../infrastructure/cache/redis-geo-cache.js';
import { NominatimProvider } from '../infrastructure/provider/nominatim-provider.js';

function fakeCache(): RedisGeoCache {
  const store = new Map<string, unknown>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: unknown) => {
      store.set(k, v);
    },
    revKey: (lat: number, lng: number) => `geo:rev:${lat.toFixed(5)}:${lng.toFixed(5)}`,
    fwdKey: (q: string) => `geo:fwd:${q}`,
  } as unknown as RedisGeoCache;
}

const fetchMock = jest.fn<typeof fetch>();

beforeEach(() => {
  jest
    .spyOn(globalThis as unknown as { fetch: typeof fetch }, 'fetch')
    .mockImplementation(fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('NominatimProvider.reverseGeocode', () => {
  it('maps a Nominatim reverse result onto Address with components', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        lat: '35.7001234',
        lon: '51.3998765',
        display_name: 'Valiasr St, Tehran, Iran',
        address: { road: 'Valiasr St', city: 'Tehran', country: 'Iran' },
      }),
    );
    const provider = new NominatimProvider({
      baseUrl: 'https://nominatim.test',
      cache: fakeCache(),
    });

    const addr = await provider.reverseGeocode(35.7001, 51.3999, 't1');
    expect(addr).toMatchObject({
      latitude: 35.7001234,
      longitude: 51.3998765,
      formatted: 'Valiasr St, Tehran, Iran',
      provider: 'nominatim',
    });
    expect(addr?.components).toEqual({ road: 'Valiasr St', city: 'Tehran', country: 'Iran' });
    // Usage-policy identification header is sent.
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toContain('FleetVision');
  });

  it('caches reverse results — a repeated lookup does not hit Nominatim again', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        lat: '35.7',
        lon: '51.4',
        display_name: 'Somewhere',
        address: {},
      }),
    );
    const provider = new NominatimProvider({
      baseUrl: 'https://nominatim.test',
      cache: fakeCache(),
    });
    await provider.reverseGeocode(35.7, 51.4);
    await provider.reverseGeocode(35.7, 51.4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when Nominatim has no address for the point', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Unable to geocode' }));
    const provider = new NominatimProvider({
      baseUrl: 'https://nominatim.test',
      cache: fakeCache(),
    });
    expect(await provider.reverseGeocode(0, 0)).toBeNull();
  });

  it('throws a controlled error when the server is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    const provider = new NominatimProvider({
      baseUrl: 'https://nominatim.test',
      cache: fakeCache(),
    });
    await expect(provider.reverseGeocode(35.7, 51.4)).rejects.toThrow(/Nominatim unreachable/);
  });
});

describe('NominatimProvider.geocode', () => {
  it('maps search results onto Address[] and caches them', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        {
          lat: '35.6892',
          lon: '51.389',
          display_name: 'Tehran, Iran',
          address: { city: 'Tehran' },
        },
        { lat: '35.7', lon: '51.4', display_name: 'Vanak, Tehran, Iran', address: {} },
      ]),
    );
    const provider = new NominatimProvider({
      baseUrl: 'https://nominatim.test',
      cache: fakeCache(),
    });
    const results = await provider.geocode({ query: 'Tehran' });
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      latitude: 35.6892,
      longitude: 51.389,
      formatted: 'Tehran, Iran',
    });
    // Cached — second call never re-fetches.
    await provider.geocode({ query: 'Tehran' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('NominatimProvider unsupported capabilities', () => {
  it('fails closed for routing so the router can pick OSRM', async () => {
    const provider = new NominatimProvider({
      baseUrl: 'https://nominatim.test',
      cache: fakeCache(),
    });
    await expect(provider.route({ waypoints: [], mode: 'static' })).rejects.toThrow(
      /does not provide routing/,
    );
    expect(provider.capabilities.has('geocode')).toBe(true);
    expect(provider.capabilities.has('route')).toBe(false);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
