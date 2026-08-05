/**
 * A typed, validated config holder. Services inject this and read strongly-typed
 * values; the schema is validated once at module construction, so the typed value
 * is always valid thereafter.
 *
 * This is the runtime side of "config via environment, not code" (§13): the same
 * Docker image runs in dev/staging/prod; only the env (ConfigMap/Secret) differs.
 */
import type { BaseConfig } from './base-config.js';

/**
 * Generic typed config service. The service-level config type flows from the
 * zod schema the app supplies to `ConfigModule.forRoot({ schema })`.
 */
export class TypedConfigService<T extends BaseConfig> {
  constructor(private readonly config: T) {}

  /** The full validated config object. */
  public get all(): T {
    return this.config;
  }

  /** Look up a config value by dotted path, e.g. `get('jwt.issuer')`. */
  public get<K extends string>(path: K): unknown {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc !== null && typeof acc === 'object' && key in (acc as object)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, this.config);
  }
}
