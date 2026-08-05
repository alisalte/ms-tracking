/**
 * Plugin loader — discovers and registers out-of-tree adapters via dynamic
 * `import()` (06 §9.3). Unlike the retired Go plugin model (Linux-only `.so`,
 * matching-toolchain), Node dynamic `import()` is cross-platform and needs only
 * a package boundary — a net simplification from the Go runtime (06 §9.3).
 *
 * Convention: a plugin module's default export is a `ProtocolAdapter` (or a
 * factory `() => ProtocolAdapter`). The loader scans a configured directory for
 * `*.js` / `*.mjs` / `*.cjs` files and registers each successfully imported
 * adapter with the registry as a `dynamic` entry.
 *
 * Failures are non-fatal: a broken plugin is logged and skipped so one bad
 * customer-specific adapter never blocks the gateway from booting.
 */
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Logger } from '@nestjs/common';
import type { ProtocolAdapter } from './protocol-adapter.js';

const PLUGIN_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

export interface PluginLoaderOptions {
  /** Directory to scan; empty/disabled when unset or absent. */
  readonly pluginDir?: string;
}

/** A plugin module's default export is an adapter, or a factory producing one. */
type PluginExport = ProtocolAdapter | (() => ProtocolAdapter);

function isAdapter(value: unknown): value is ProtocolAdapter {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ProtocolAdapter).id === 'string' &&
    typeof (value as ProtocolAdapter).detect === 'function' &&
    typeof (value as ProtocolAdapter).frame === 'function' &&
    typeof (value as ProtocolAdapter).decode === 'function'
  );
}

function asAdapter(exported: unknown): ProtocolAdapter | null {
  if (isAdapter(exported)) return exported;
  if (typeof exported === 'function') {
    try {
      const made = (exported as () => ProtocolAdapter)();
      return isAdapter(made) ? made : null;
    } catch {
      return null;
    }
  }
  return null;
}

export class PluginLoader {
  private readonly logger = new Logger(PluginLoader.name);
  constructor(private readonly options: PluginLoaderOptions = {}) {}

  /**
   * Discover plugin modules under the configured directory and return the
   * adapters they export. Does not register — the caller (the wiring module)
   * registers each via the AdapterRegistry.
   */
  public async discover(): Promise<readonly ProtocolAdapter[]> {
    const dir = this.options.pluginDir;
    if (!dir) return [];
    if (!existsSync(dir)) {
      this.logger.warn(`Plugin directory does not exist: ${dir} — skipping.`);
      return [];
    }

    const found: ProtocolAdapter[] = [];
    let entries: readonly string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      this.logger.warn(
        `Could not read plugin directory ${dir}: ${(err as Error).message} — skipping.`,
      );
      return [];
    }

    for (const entry of entries) {
      if (!PLUGIN_EXTENSIONS.has(extname(entry))) continue;
      const filePath = join(dir, entry);
      try {
        const mod = (await import(pathToFileURL(resolvePath(filePath)).href)) as {
          default?: PluginExport;
        };
        const adapter = asAdapter(mod.default);
        if (!adapter) {
          this.logger.warn(
            `Plugin '${entry}' did not export a valid ProtocolAdapter default — skipping.`,
          );
          continue;
        }
        found.push(adapter);
        this.logger.log(`Discovered plugin adapter '${adapter.id}' from ${entry}.`);
      } catch (err) {
        // One broken plugin must not block boot (06 §9.3 — non-fatal).
        this.logger.warn(`Failed to load plugin '${entry}': ${(err as Error).message}.`);
      }
    }
    return found;
  }
}

/** Resolve a path for the file:// URL (handles already-URL inputs in tests). */
function resolvePath(p: string): string {
  try {
    return fileURLToPath(p);
  } catch {
    return p;
  }
}
