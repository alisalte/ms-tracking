/**
 * Nominatim provider — real geocoding / reverse geocoding against OSM's
 * Nominatim (Sprint F §13). Self-hostable; the public instance works for the
 * low query volumes this engine generates because geocoding is ONLY performed
 * on justified events (selected vehicle, explicit user request) — never per
 * GPS packet — and every result is cached in Redis.
 *
 * Configured via `NOMINATIM_URL` (empty = provider not registered; the local
 * `geo.addresses` provider then serves reverse geocoding, or the operation
 * fails closed). Caches: `geo:rev:<lat>:<lng>` (reverse, rounded to ~1 m) and
 * `geo:fwd:<sha>` (forward) with the standard geo-cache TTL — bounded, never
 * unbounded (Sprint F §14).
 */
import type { Address, PlaceResult, RouteResult, SnappedPoint } from '../../domain/geo-types.js';
import type {
  GeocodeRequest,
  MapProvider,
  ProviderCapability,
  SnapRequest,
} from '../../domain/map-provider.js';
import {
  MapProviderUnavailableError,
  RouteUnavailableError,
} from '../../domain/provider-errors.js';
import type { RedisGeoCache } from '../cache/redis-geo-cache.js';

const REQUEST_TIMEOUT_MS = 10_000;

export interface NominatimProviderDeps {
  /** Base URL, e.g. `https://nominatim.openstreetmap.org` (no trailing slash). */
  readonly baseUrl: string;
  /**
   * User-Agent / From header value — REQUIRED by the public Nominatim usage
   * policy (identify the application). Defaults to the service name.
   */
  readonly userAgent?: string;
  readonly cache: RedisGeoCache;
  /** Preferred language for rendered addresses (BCP-47). */
  readonly language?: string;
}

interface NominatimPlace {
  readonly lat: string;
  readonly lon: string;
  readonly display_name?: string;
  readonly name?: string;
  readonly type?: string;
  readonly class?: string;
  readonly address?: Record<string, string>;
}

export class NominatimProvider implements MapProvider {
  public readonly name = 'nominatim';
  public readonly capabilities: ReadonlySet<ProviderCapability> = new Set([
    'geocode',
    'reverseGeocode',
    'searchPlaces',
  ]);

  constructor(private readonly deps: NominatimProviderDeps) {}

  public async reverseGeocode(
    lat: number,
    lng: number,
    _tenantId?: string,
  ): Promise<Address | null> {
    const cacheKey = this.deps.cache.revKey(lat, lng);
    const cached = await this.deps.cache.get<Address>(cacheKey);
    if (cached) return cached;

    const url =
      `${this.deps.baseUrl}/reverse?format=jsonv2&lat=${lat}&lon=${lng}` +
      `&zoom=18&addressdetails=1${this.deps.language ? `&accept-language=${encodeURIComponent(this.deps.language)}` : ''}`;
    const place = await this.nominatimFetch<NominatimPlace | null>(url);
    if (!place || place.display_name === undefined) return null; // genuinely no address

    const addr: Address = {
      latitude: Number(place.lat),
      longitude: Number(place.lon),
      formatted: place.display_name,
      components: place.address ?? {},
      provider: this.name,
    };
    await this.deps.cache.set(cacheKey, addr);
    return addr;
  }

  public async geocode(req: GeocodeRequest): Promise<Address[]> {
    const cacheKey = this.deps.cache.fwdKey(req.query);
    const cached = await this.deps.cache.get<Address[]>(cacheKey);
    if (cached) return cached;

    const url =
      `${this.deps.baseUrl}/search?format=jsonv2&addressdetails=1&limit=10` +
      `&q=${encodeURIComponent(req.query)}` +
      (this.deps.language ? `&accept-language=${encodeURIComponent(this.deps.language)}` : '');
    const places = await this.nominatimFetch<NominatimPlace[]>(url);

    const results = places.map((p): Address => {
      const { latitude, longitude, formatted, components } = normalizePlace(p);
      return { latitude, longitude, formatted, components, provider: this.name };
    });
    await this.deps.cache.set(cacheKey, results);
    return results;
  }

  public async searchPlaces(req: {
    query: string;
    latitude?: number;
    longitude?: number;
  }): Promise<PlaceResult[]> {
    // Nominatim has no true "near" scoping without a bbox; when coordinates are
    // supplied we constrain the search to a ~10 km viewbox.
    const params = new URLSearchParams({ format: 'jsonv2', limit: '10', q: req.query });
    if (this.deps.language) params.set('accept-language', this.deps.language);
    if (req.latitude !== undefined && req.longitude !== undefined) {
      const d = 0.09; // ≈10 km in degrees
      params.set(
        'viewbox',
        [req.longitude - d, req.latitude + d, req.longitude + d, req.latitude - d].join(','),
      );
    }
    const places = await this.nominatimFetch<NominatimPlace[]>(
      `${this.deps.baseUrl}/search?${params.toString()}`,
    );
    return places.map((p) => {
      const { latitude, longitude, name, category } = normalizePlace(p);
      return { name, category, latitude, longitude, distanceM: null };
    });
  }

  // --- Not Nominatim capabilities (fail closed so the router picks OSRM/local) ---

  public async route(_req: Parameters<MapProvider['route']>[0]): Promise<RouteResult> {
    throw new RouteUnavailableError('Nominatim does not provide routing');
  }

  public async matchRoute(
    _points: readonly { lat: number; lng: number }[],
    _tenantId?: string,
  ): Promise<SnappedPoint[]> {
    throw new MapProviderUnavailableError('Nominatim does not provide map matching');
  }

  public async snapPoint(_req: SnapRequest): Promise<SnappedPoint> {
    throw new MapProviderUnavailableError('Nominatim does not provide snapping');
  }

  private async nominatimFetch<T>(url: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          // Usage-policy requirement: identify the application.
          'User-Agent': this.deps.userAgent ?? 'FleetVision-MapEngine/1.0',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new MapProviderUnavailableError(
        `Nominatim unreachable at ${this.deps.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!response.ok) {
      throw new MapProviderUnavailableError(`Nominatim HTTP ${response.status} for ${url}`);
    }
    return (await response.json()) as T;
  }
}

/** Map a Nominatim place onto the shared components used by Address/PlaceResult. */
function normalizePlace(p: NominatimPlace): {
  latitude: number;
  longitude: number;
  formatted: string;
  components: Record<string, string>;
  name: string;
  category: string;
} {
  return {
    latitude: Number(p.lat),
    longitude: Number(p.lon),
    formatted: p.display_name ?? p.name ?? '',
    components: p.address ?? {},
    name: p.name ?? p.display_name ?? '',
    category: p.type ?? p.class ?? 'unknown',
  };
}
