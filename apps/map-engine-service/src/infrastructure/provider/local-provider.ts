/**
 * Local provider — the default MapProvider implementation (08 §2.4).
 *
 * Functional without external APIs. Uses the `geo.addresses` + `geo.pois` tables
 * for geocoding/places, and haversine for routing. When external providers
 * (Mapbox/Google/OSRM) are configured, the ProviderRouter may prefer them; the
 * local provider is always available as a fallback.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import type { Address, PlaceResult, RouteResult, SnappedPoint } from '../../domain/geo-types.js';
import type { MapProvider } from '../../domain/map-provider.js';
import type { RedisGeoCache } from '../cache/redis-geo-cache.js';

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

export interface LocalProviderDeps {
  readonly knex: Knex;
  readonly cache: RedisGeoCache;
}

export class LocalProvider implements MapProvider {
  public readonly name = 'local';

  constructor(private readonly deps: LocalProviderDeps) {}

  public async geocode(req: { query: string }): Promise<Address[]> {
    const { knex } = this.deps;
    const rows = await knex
      .withSchema('geo')
      .from('addresses')
      .whereRaw("to_tsvector('simple', formatted_address) @@ plainto_tsquery(?)", [req.query])
      .limit(10);
    return (rows as { formatted_address: string }[]).map((r) => ({
      latitude: 0,
      longitude: 0,
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

  public async route(req: {
    waypoints: readonly { lat: number; lng: number }[];
    mode: string;
  }): Promise<RouteResult> {
    // Straight-line routing: sum haversine distances between consecutive waypoints.
    const { waypoints } = req;
    let distanceM = 0;
    for (let i = 1; i < waypoints.length; i++) {
      const a = waypoints[i - 1];
      const b = waypoints[i];
      if (a && b) distanceM += haversine(a.lat, a.lng, b.lat, b.lng);
    }
    // Assume 50 km/h average for a rough duration estimate.
    const durationSec = (distanceM / 1000 / 50) * 3600;
    return {
      distanceKm: distanceM / 1000,
      durationSec: Math.round(durationSec),
      geometry: waypoints.map((w) => ({ lat: w.lat, lng: w.lng })),
      mode: req.mode as RouteResult['mode'],
      provider: 'local',
    };
  }

  public async matchRoute(
    points: readonly { lat: number; lng: number }[],
  ): Promise<SnappedPoint[]> {
    // Pass-through (no road graph for the local provider).
    return points.map((p) => ({
      latitude: p.lat,
      longitude: p.lng,
      roadName: null,
      postedLimitKmh: null,
      confidence: 0.3,
      provider: 'local',
    }));
  }

  public async snapPoint(req: { latitude: number; longitude: number }): Promise<SnappedPoint> {
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
    const rows = await knex
      .withSchema('geo')
      .from('pois')
      .whereRaw('name ILIKE ?', [`%${req.query}%`])
      .limit(10);
    return (rows as { name: string; category: string }[]).map((r) => ({
      name: r.name,
      category: r.category,
      latitude: 0,
      longitude: 0,
      distanceM: null,
    }));
  }
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lng2 - lng1);
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
