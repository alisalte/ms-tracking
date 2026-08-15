/**
 * Local provider — the always-available MapProvider implementation (08 §2.4).
 *
 * Functional without external APIs: geocoding/places come from the `geo.addresses`
 * + `geo.pois` tables (PostGIS-backed) and reverse geocoding resolves the nearest
 * known address within 500 m. ROUTING IS NOT A LOCAL CAPABILITY (Sprint F §12):
 * there is no road graph, so `route()` throws a controlled
 * `RouteUnavailableError` — the straight-line + 50 km/h fabrication is gone.
 * Deploy OSRM (`OSRM_URL`) for real routing; the ProviderRouter resolves it.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import type { Address, PlaceResult, RouteResult, SnappedPoint } from '../../domain/geo-types.js';
import type { GeocodeRequest, MapProvider, SnapRequest } from '../../domain/map-provider.js';
import { RouteUnavailableError } from '../../domain/provider-errors.js';
import type { RedisGeoCache } from '../cache/redis-geo-cache.js';

export interface LocalProviderDeps {
  readonly knex: Knex;
  readonly cache: RedisGeoCache;
}

export class LocalProvider implements MapProvider {
  public readonly name = 'local';
  public readonly capabilities: ReadonlySet<
    'geocode' | 'reverseGeocode' | 'matchRoute' | 'snapPoint' | 'searchPlaces'
  > = new Set(['geocode', 'reverseGeocode', 'matchRoute', 'snapPoint', 'searchPlaces']);

  constructor(private readonly deps: LocalProviderDeps) {}

  public async geocode(req: GeocodeRequest): Promise<Address[]> {
    const { knex } = this.deps;
    // Extract the real coordinates from the geography column (Sprint F: the
    // old query matched rows but returned latitude/longitude 0,0).
    const rows = await knex
      .withSchema('geo')
      .from('addresses')
      .select(
        'formatted_address',
        knex.raw('ST_Y(geom::geometry) AS lat'),
        knex.raw('ST_X(geom::geometry) AS lng'),
      )
      .whereRaw("to_tsvector('simple', formatted_address) @@ plainto_tsquery(?)", [req.query])
      .limit(10);
    return (
      rows as { formatted_address: string; lat: string | number; lng: string | number }[]
    ).map((r) => ({
      latitude: Number(r.lat),
      longitude: Number(r.lng),
      formatted: r.formatted_address,
      components: {},
      provider: 'local',
    }));
  }

  public async reverseGeocode(lat: number, lng: number): Promise<Address | null> {
    const cached = await this.deps.cache.get<Address>(this.deps.cache.revKey(lat, lng));
    if (cached) return cached;
    const { knex } = this.deps;
    const pointWkt = `SRID=4326;POINT(${lng} ${lat})`;
    const row = await knex
      .withSchema('geo')
      .from('addresses')
      .select('formatted_address')
      .whereRaw('ST_DWithin(geom, ?::geography, 500)', [pointWkt])
      .orderByRaw('geom <-> ?::geography', [pointWkt])
      .first();
    if (!row) return null;
    const addr: Address = {
      latitude: lat,
      longitude: lng,
      formatted: (row as { formatted_address: string }).formatted_address,
      components: {},
      provider: 'local',
    };
    await this.deps.cache.set(this.deps.cache.revKey(lat, lng), addr);
    return addr;
  }

  public async route(): Promise<RouteResult> {
    // No road graph locally — fabricating a straight-line "route" with an
    // invented duration is worse than a controlled failure (Sprint F §12).
    throw new RouteUnavailableError(
      'The local provider has no road network — configure OSRM_URL for real routing',
    );
  }

  public async matchRoute(
    points: readonly { lat: number; lng: number }[],
  ): Promise<SnappedPoint[]> {
    // Honest pass-through: no road graph, so points are returned unchanged at
    // a low, explicit confidence (never presented as road-snapped).
    return points.map((p) => ({
      latitude: p.lat,
      longitude: p.lng,
      roadName: null,
      postedLimitKmh: null,
      confidence: 0.3,
      provider: 'local',
    }));
  }

  public async snapPoint(req: SnapRequest): Promise<SnappedPoint> {
    return {
      latitude: req.latitude,
      longitude: req.longitude,
      roadName: null,
      postedLimitKmh: null,
      confidence: 0.3,
      provider: 'local',
    };
  }

  public async searchPlaces(req: {
    query: string;
    latitude?: number;
    longitude?: number;
  }): Promise<PlaceResult[]> {
    const { knex } = this.deps;
    // Real coordinates from the geography column (was 0,0).
    const rows = await knex
      .withSchema('geo')
      .from('pois')
      .select(
        'name',
        'category',
        knex.raw('ST_Y(geom::geometry) AS lat'),
        knex.raw('ST_X(geom::geometry) AS lng'),
      )
      .whereRaw('name ILIKE ?', [`%${req.query}%`])
      .limit(10);
    return (
      rows as { name: string; category: string; lat: string | number; lng: string | number }[]
    ).map((r) => ({
      name: r.name,
      category: r.category,
      latitude: Number(r.lat),
      longitude: Number(r.lng),
      distanceM: null,
    }));
  }
}
