/**
 * ProviderRouter — selects a MapProvider per call (08 §2.3).
 *
 * Selection priority: region (China → Amap/Baidu) → tenant pin → budget gate →
 * health (circuit breaker). Since Sprint F the router is CAPABILITY-AWARE:
 * `selectFor(op)` resolves the provider that actually serves the requested
 * operation (e.g. OSRM for routing, Nominatim or the local DB for geocoding),
 * trying the configured default first and then any other registered provider.
 * When no provider serves the operation, a controlled
 * `MapProviderUnavailableError` is thrown — callers never receive fabricated
 * geometry or addresses from a silent stub fallback.
 */
import type { MapProvider, ProviderCapability } from '../domain/map-provider.js';
import { MapProviderUnavailableError } from '../domain/provider-errors.js';

export interface ProviderRouterDeps {
  readonly providers: ReadonlyMap<string, MapProvider>;
  readonly defaultProvider: string;
  readonly region: string;
}

export class ProviderRouter {
  constructor(private readonly deps: ProviderRouterDeps) {}

  /** Select the provider for the current call context. */
  public select(opts: { tenantId?: string; region?: string } = {}): MapProvider {
    const region = opts.region ?? this.deps.region;

    // China → Amap/Baidu (when configured).
    if (region === 'china') {
      const amap = this.deps.providers.get('amap');
      if (amap) return amap;
    }

    // Tenant pin (future: enterprise contract pins a provider).
    // Budget gate (future: at 80% Mapbox quota → OSRM).
    // Health (future: circuit breaker 5 errs/30s → failover).

    // Default: the configured default.
    const provider = this.deps.providers.get(this.deps.defaultProvider);
    if (!provider) {
      throw new Error(`Default provider '${this.deps.defaultProvider}' not configured.`);
    }
    return provider;
  }

  /**
   * Select a provider that serves `op` (Sprint F §4/§5): the region-pinned or
   * default provider when capable, otherwise the first other registered
   * provider with the capability. Throws a controlled error when nothing can
   * serve the operation.
   */
  public selectFor(
    op: ProviderCapability,
    opts: { tenantId?: string; region?: string } = {},
  ): MapProvider {
    const preferred = (() => {
      try {
        return this.select(opts);
      } catch {
        return undefined;
      }
    })();
    if (preferred?.capabilities.has(op)) return preferred;

    for (const provider of this.deps.providers.values()) {
      if (provider.capabilities.has(op)) return provider;
    }
    throw new MapProviderUnavailableError(
      `No configured map provider serves '${op}' ` +
        `(default '${this.deps.defaultProvider}' does not; configure e.g. OSRM_URL / NOMINATIM_URL).`,
    );
  }
}
