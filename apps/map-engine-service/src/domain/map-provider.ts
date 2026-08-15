/**
 * MapProvider — the provider abstraction seam (08 §2.4; MapEngine.md §4.1).
 *
 * Every external map provider (Mapbox, Google, OSRM, Amap/Baidu) and the local
 * default implements this interface. The ProviderRouter selects one per call by
 * region → tenant → budget → health (§2.3). This is the single point of
 * provider swap/failover.
 */
import type { Address, PlaceResult, RouteResult, SnappedPoint } from './geo-types.js';

/**
 * The operations a provider can serve. Providers declare their capabilities;
 * the ProviderRouter resolves per-operation so a deployment can mix, e.g.,
 * OSRM (routing) with Nominatim (geocoding) and the local DB provider
 * (reverse geocode from `geo.addresses`).
 */
export type ProviderCapability =
  | 'geocode'
  | 'reverseGeocode'
  | 'route'
  | 'matchRoute'
  | 'snapPoint'
  | 'searchPlaces';

export interface GeocodeRequest {
  readonly query: string;
  readonly tenantId?: string;
  readonly region?: string;
}

export interface RouteRequest {
  readonly waypoints: readonly { lat: number; lng: number }[];
  readonly mode: 'static' | 'live' | 'optimized';
  readonly tenantId?: string;
}

export interface SnapRequest {
  readonly latitude: number;
  readonly longitude: number;
  readonly tenantId?: string;
}

export interface PlacesRequest {
  readonly query: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly radiusM?: number;
  readonly tenantId?: string;
}

/** The port every map provider implements. */
export interface MapProvider {
  readonly name: string;

  /**
   * Capabilities this provider actually serves. Methods outside this set MUST
   * throw `MapProviderUnavailableError` — the router uses the set to resolve
   * per-operation providers and never silently falls back to a stub.
   */
  readonly capabilities: ReadonlySet<ProviderCapability>;

  /** Forward geocode: address string → coordinates + formatted address. */
  geocode(req: GeocodeRequest): Promise<Address[]>;

  /** Reverse geocode: coordinates → address. */
  reverseGeocode(lat: number, lng: number, tenantId?: string): Promise<Address | null>;

  /** Route between waypoints. */
  route(req: RouteRequest): Promise<RouteResult>;

  /** Map-match a position sequence to a road path. */
  matchRoute(
    points: readonly { lat: number; lng: number }[],
    tenantId?: string,
  ): Promise<SnappedPoint[]>;

  /** Snap a single point to the nearest road. */
  snapPoint(req: SnapRequest): Promise<SnappedPoint>;

  /** Search for places/POIs near a location. */
  searchPlaces(req: PlacesRequest): Promise<PlaceResult[]>;
}
