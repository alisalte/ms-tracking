/**
 * OSRM provider — real road-network routing, map-matching and snapping (Sprint F §12).
 *
 * Talks to any OSRM-compatible server (self-hosted `osrm-routed`, or the public
 * demo instance) over plain HTTP using the Node 22 built-in `fetch` — no SDK, no
 * API key. Configured via `OSRM_URL`; when unset the provider is simply not
 * registered and routing surfaces a controlled 503 instead of a straight-line
 * fabrication. Route results are cached in Redis (`geo:route:*`) with the
 * standard geo-cache TTL.
 *
 * Capabilities: route, matchRoute, snapPoint. Geocoding is NOT an OSRM feature
 * — those methods throw `MapProviderUnavailableError` so the router picks
 * Nominatim or the local provider instead.
 */
import type { Address, PlaceResult, RouteResult, SnappedPoint } from '../../domain/geo-types.js';
import type { GeocodeRequest } from '../../domain/map-provider.js';
import type { MapProvider, ProviderCapability } from '../../domain/map-provider.js';
import {
  MapProviderUnavailableError,
  RouteUnavailableError,
} from '../../domain/provider-errors.js';
import type { RedisGeoCache } from '../cache/redis-geo-cache.js';

const REQUEST_TIMEOUT_MS = 10_000;

export interface OsrmProviderDeps {
  /** Base URL of the OSRM server, e.g. `http://localhost:5000` (no trailing slash). */
  readonly baseUrl: string;
  /** OSRM profile the server was built with (default `driving`). */
  readonly profile?: string;
  readonly cache: RedisGeoCache;
}

interface OsrmRouteResponse {
  readonly code: string;
  readonly message?: string;
  readonly routes?: ReadonlyArray<{
    readonly distance: number; // meters
    readonly duration: number; // seconds
    readonly geometry?: { readonly coordinates: ReadonlyArray<[number, number]> }; // [lng, lat]
  }>;
}

interface OsrmNearestResponse {
  readonly code: string;
  readonly waypoints?: ReadonlyArray<{
    readonly location: [number, number];
    readonly name?: string;
  }>;
}

export class OsrmProvider implements MapProvider {
  public readonly name = 'osrm';
  public readonly capabilities: ReadonlySet<ProviderCapability> = new Set([
    'route',
    'matchRoute',
    'snapPoint',
  ]);

  private readonly profile: string;

  constructor(private readonly deps: OsrmProviderDeps) {
    this.profile = deps.profile ?? 'driving';
  }

  public async route(req: {
    waypoints: readonly { lat: number; lng: number }[];
    mode: 'static' | 'live' | 'optimized';
    tenantId?: string;
  }): Promise<RouteResult> {
    if (req.waypoints.length < 2) {
      throw new RouteUnavailableError('At least 2 waypoints are required');
    }
    const cacheKey = this.deps.cache.routeKey(req.waypoints, req.mode);
    const cached = await this.deps.cache.get<RouteResult>(cacheKey);
    if (cached) return cached;

    const coords = req.waypoints.map((w) => `${w.lng},${w.lat}`).join(';');
    const url =
      `${this.deps.baseUrl}/route/v1/${this.profile}/${coords}` +
      '?overview=full&geometries=geojson';
    const body = await this.osrmFetch<OsrmRouteResponse>(url);

    if (body.code !== 'Ok' || !body.routes?.length) {
      throw new RouteUnavailableError(
        `OSRM could not route the waypoints (${body.code}${body.message ? `: ${body.message}` : ''})`,
      );
    }
    const route = body.routes[0];
    if (!route) throw new RouteUnavailableError('OSRM returned no route');

    const result: RouteResult = {
      distanceKm: route.distance / 1000,
      durationSec: Math.round(route.duration),
      geometry: (route.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng })),
      mode: req.mode,
      provider: this.name,
    };
    await this.deps.cache.set(cacheKey, result);
    return result;
  }

  public async matchRoute(
    points: readonly { lat: number; lng: number }[],
    _tenantId?: string,
  ): Promise<SnappedPoint[]> {
    if (points.length < 2) {
      throw new RouteUnavailableError('At least 2 points are required for map matching');
    }
    const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
    const url = `${this.deps.baseUrl}/match/v1/${this.profile}/${coords}?geometries=geojson`;
    const body = await this.osrmFetch<OsrmRouteResponse>(url);
    if (body.code !== 'Ok') {
      throw new RouteUnavailableError(`OSRM match failed (${body.code})`);
    }
    // The match service snaps each input point onto the road path.
    const snapped =
      body.routes?.[0]?.geometry?.coordinates.map(([lng, lat]) => ({ lat, lng })) ?? [];
    return points.map((p, i) => {
      const s = snapped[i];
      return {
        latitude: s?.lat ?? p.lat,
        longitude: s?.lng ?? p.lng,
        roadName: null,
        postedLimitKmh: null,
        confidence: s ? 1 : 0,
        provider: this.name,
      };
    });
  }

  public async snapPoint(req: { latitude: number; longitude: number }): Promise<SnappedPoint> {
    const url =
      `${this.deps.baseUrl}/nearest/v1/${this.profile}/${req.longitude},${req.latitude}` +
      '?number=1';
    const body = await this.osrmFetch<OsrmNearestResponse>(url);
    const wp = body.code === 'Ok' ? body.waypoints?.[0] : undefined;
    if (!wp?.location) {
      throw new RouteUnavailableError(`OSRM nearest returned no waypoint (${body.code})`);
    }
    return {
      latitude: wp.location[1],
      longitude: wp.location[0],
      roadName: wp.name || null,
      postedLimitKmh: null,
      confidence: 1,
      provider: this.name,
    };
  }

  // --- Not OSRM capabilities (fail closed so the router can pick another provider) ---

  public async geocode(_req: GeocodeRequest): Promise<Address[]> {
    throw new MapProviderUnavailableError('OSRM does not provide geocoding');
  }

  public async reverseGeocode(_lat: number, _lng: number): Promise<Address | null> {
    throw new MapProviderUnavailableError('OSRM does not provide reverse geocoding');
  }

  public async searchPlaces(_req: {
    query: string;
    latitude?: number;
    longitude?: number;
  }): Promise<PlaceResult[]> {
    throw new MapProviderUnavailableError('OSRM does not provide place search');
  }

  /** Fetch + normalize OSRM HTTP failures into controlled provider errors. */
  private async osrmFetch<T>(url: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      throw new MapProviderUnavailableError(
        `OSRM unreachable at ${this.deps.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!response.ok) {
      throw new MapProviderUnavailableError(`OSRM HTTP ${response.status} for ${url}`);
    }
    return (await response.json()) as T;
  }
}
