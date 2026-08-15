/**
 * OSRM provider tests (Sprint F §28-1): real routing/matching/snapping against
 * a mocked OSRM HTTP server, controlled failures, and route caching.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { RedisGeoCache } from '../infrastructure/cache/redis-geo-cache.js';
import { OsrmProvider } from '../infrastructure/provider/osrm-provider.js';

function fakeCache(): RedisGeoCache {
  const store = new Map<string, unknown>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: unknown) => {
      store.set(k, v);
    },
    routeKey: (wp: readonly { lat: number; lng: number }[], mode: string) =>
      `geo:route:${mode}:${wp.length}`,
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

const okRoute = {
  code: 'Ok',
  routes: [
    {
      distance: 12_345, // meters
      duration: 900, // seconds
      geometry: {
        coordinates: [
          [51.3, 35.7],
          [51.31, 35.71],
          [51.32, 35.72],
        ],
      },
    },
  ],
};

describe('OsrmProvider.route', () => {
  it('maps a successful OSRM response onto RouteResult', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(okRoute));
    const provider = new OsrmProvider({ baseUrl: 'http://osrm:5000', cache: fakeCache() });

    const result = await provider.route({
      waypoints: [
        { lat: 35.7, lng: 51.3 },
        { lat: 35.72, lng: 51.32 },
      ],
      mode: 'static',
    });

    expect(result.distanceKm).toBeCloseTo(12.345);
    expect(result.durationSec).toBe(900);
    expect(result.provider).toBe('osrm');
    expect(result.geometry).toEqual([
      { lat: 35.7, lng: 51.3 },
      { lat: 35.71, lng: 51.31 },
      { lat: 35.72, lng: 51.32 },
    ]);
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain('/route/v1/driving/51.3,35.7;51.32,35.72');
    expect(url).toContain('overview=full');
    expect(url).toContain('geometries=geojson');
  });

  it('caches route results in Redis (second call does not hit OSRM)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(okRoute));
    const provider = new OsrmProvider({ baseUrl: 'http://osrm:5000', cache: fakeCache() });
    const req = {
      waypoints: [
        { lat: 35.7, lng: 51.3 },
        { lat: 35.72, lng: 51.32 },
      ],
      mode: 'static' as const,
    };
    await provider.route(req);
    await provider.route(req);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws a controlled RouteUnavailableError when OSRM cannot route', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'NoRoute' }));
    const provider = new OsrmProvider({ baseUrl: 'http://osrm:5000', cache: fakeCache() });
    await expect(
      provider.route({
        waypoints: [
          { lat: 0, lng: 0 },
          { lat: 1, lng: 1 },
        ],
        mode: 'static',
      }),
    ).rejects.toThrow(/NoRoute/);
  });

  it('throws a controlled MapProviderUnavailableError when the server is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const provider = new OsrmProvider({ baseUrl: 'http://osrm:5000', cache: fakeCache() });
    await expect(
      provider.route({
        waypoints: [
          { lat: 0, lng: 0 },
          { lat: 1, lng: 1 },
        ],
        mode: 'static',
      }),
    ).rejects.toThrow(/OSRM unreachable/);
  });

  it('throws when OSRM answers with an HTTP error status', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const provider = new OsrmProvider({ baseUrl: 'http://osrm:5000', cache: fakeCache() });
    await expect(
      provider.route({
        waypoints: [
          { lat: 0, lng: 0 },
          { lat: 1, lng: 1 },
        ],
        mode: 'static',
      }),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe('OsrmProvider.snapPoint', () => {
  it('snaps to the nearest waypoint with its road name', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        code: 'Ok',
        waypoints: [{ location: [51.3001, 35.7002], name: 'Valiasr St' }],
      }),
    );
    const provider = new OsrmProvider({ baseUrl: 'http://osrm:5000', cache: fakeCache() });
    const snapped = await provider.snapPoint({ latitude: 35.7, longitude: 51.3 });
    expect(snapped).toMatchObject({
      latitude: 35.7002,
      longitude: 51.3001,
      roadName: 'Valiasr St',
      confidence: 1,
      provider: 'osrm',
    });
  });

  it('fails closed when the nearest service returns no waypoint', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'NoSegment' }));
    const provider = new OsrmProvider({ baseUrl: 'http://osrm:5000', cache: fakeCache() });
    await expect(provider.snapPoint({ latitude: 0, longitude: 0 })).rejects.toThrow(/NoSegment/);
  });
});

describe('OsrmProvider unsupported capabilities', () => {
  it('fails closed for geocoding so the router can pick another provider', async () => {
    const provider = new OsrmProvider({ baseUrl: 'http://osrm:5000', cache: fakeCache() });
    await expect(provider.geocode({ query: 'x' })).rejects.toThrow(/does not provide geocoding/);
    await expect(provider.reverseGeocode(0, 0)).rejects.toThrow(/reverse geocoding/);
    expect(provider.capabilities.has('route')).toBe(true);
    expect(provider.capabilities.has('geocode')).toBe(false);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
