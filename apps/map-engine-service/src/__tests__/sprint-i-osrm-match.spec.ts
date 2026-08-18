/**
 * OSRM map-matching tests (Sprint I §61 MAP MATCH 27–29): tracepoint-aligned
 * snapping, unmatched-point raw fallback, caching, and controlled failures.
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
    matchKey: (points: readonly { lat: number; lng: number }[]) => `geo:match:${points.length}`,
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

describe('OsrmProvider.matchRoute (Sprint I §38)', () => {
  it('27. maps tracepoints 1:1 onto the input points (matched → confidence 1)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        code: 'Ok',
        tracepoints: [
          { location: [51.3001, 35.7001], name: 'Valiasr St' },
          { location: [51.3102, 35.7102], name: null },
        ],
      }),
    );
    const provider = new OsrmProvider({ baseUrl: 'http://osrm:5000', cache: fakeCache() });
    const snapped = await provider.matchRoute([
      { lat: 35.7, lng: 51.3 },
      { lat: 35.71, lng: 51.31 },
    ]);
    expect(snapped).toHaveLength(2);
    expect(snapped[0]).toMatchObject({
      latitude: 35.7001,
      longitude: 51.3001,
      roadName: 'Valiasr St',
      confidence: 1,
      provider: 'osrm',
    });
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain('/match/v1/driving/51.3,35.7;51.31,35.71');
  });

  it('28. unmatched tracepoint (null) falls back to the RAW point with confidence 0', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        code: 'Ok',
        tracepoints: [{ location: [51.3001, 35.7001] }, null],
      }),
    );
    const provider = new OsrmProvider({ baseUrl: 'http://osrm:5000', cache: fakeCache() });
    const snapped = await provider.matchRoute([
      { lat: 35.7, lng: 51.3 },
      { lat: 35.71, lng: 51.31 },
    ]);
    expect(snapped[1]).toMatchObject({
      latitude: 35.71,
      longitude: 51.31,
      confidence: 0,
      provider: 'osrm',
    });
  });

  it('caches match results (second call does not hit OSRM — §42)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        code: 'Ok',
        tracepoints: [{ location: [51.3, 35.7] }, { location: [51.31, 35.71] }],
      }),
    );
    const provider = new OsrmProvider({ baseUrl: 'http://osrm:5000', cache: fakeCache() });
    const pts = [
      { lat: 35.7, lng: 51.3 },
      { lat: 35.71, lng: 51.31 },
    ];
    await provider.matchRoute(pts);
    await provider.matchRoute(pts);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('network failure → controlled MapProviderUnavailableError (never fabricated)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const provider = new OsrmProvider({ baseUrl: 'http://osrm:5000', cache: fakeCache() });
    await expect(
      provider.matchRoute([
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
      ]),
    ).rejects.toThrow(/OSRM unreachable/);
  });

  it('non-Ok code → controlled RouteUnavailableError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'NoMatch', message: 'too sparse' }));
    const provider = new OsrmProvider({ baseUrl: 'http://osrm:5000', cache: fakeCache() });
    await expect(
      provider.matchRoute([
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
      ]),
    ).rejects.toThrow(/NoMatch/);
  });

  it('fewer than 2 points → controlled error before any fetch', async () => {
    const provider = new OsrmProvider({ baseUrl: 'http://osrm:5000', cache: fakeCache() });
    await expect(provider.matchRoute([{ lat: 0, lng: 0 }])).rejects.toThrow(/2 points/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
