/**
 * ProviderRouter — selects a MapProvider per call (08 §2.3).
 *
 * Selection priority: region (China → Amap/Baidu) → tenant pin → budget gate →
 * health (circuit breaker). For Sprint 9, only the local provider is configured;
 * the selection logic is the extension point for when external providers land.
 */
import type { MapProvider } from '../domain/map-provider.js';

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

    // Default: the configured default (local for Sprint 9).
    const provider = this.deps.providers.get(this.deps.defaultProvider);
    if (!provider) {
      throw new Error(`Default provider '${this.deps.defaultProvider}' not configured.`);
    }
    return provider;
  }
}
