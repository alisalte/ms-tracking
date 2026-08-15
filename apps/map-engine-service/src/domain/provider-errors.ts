/**
 * Provider error types — controlled failures for the map-provider seam.
 *
 * Sprint F §12/§24: when an external provider is unavailable or cannot serve a
 * request, the engine must surface a CONTROLLED error — never fabricate route
 * geometry, durations, or addresses. These errors are mapped to HTTP 503 by the
 * controllers so clients can distinguish "provider down" from "bad request".
 */

/** The configured provider cannot serve this capability at all (e.g. the local
 * provider has no road graph, or no OSRM/Nominatim URL is configured). */
export class MapProviderUnavailableError extends Error {
  public readonly code = 'MAP_PROVIDER_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'MapProviderUnavailableError';
  }
}

/** The provider is reachable but found no usable route between the waypoints. */
export class RouteUnavailableError extends Error {
  public readonly code = 'ROUTE_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'RouteUnavailableError';
  }
}
