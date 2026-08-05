/**
 * AdapterRegistry — the Protocol Abstraction Layer (06 §9).
 *
 * Holds the set of registered adapters, selects one for a multiplexed listener
 * via peek-based detection (06 §2.3), and supports enable/disable + hot reload
 * (06 §9.4). The TCP/UDP servers resolve an adapter per connection here; the
 * admin API toggles listeners here.
 *
 * Built-in adapters self-register via `register()` on `onModuleInit()`; out-of-tree
 * adapters register via the PluginLoader (06 §9.3).
 */
import { Logger } from '@nestjs/common';
import { ProtocolError } from '../../domain/errors.js';
import type { ProtocolAdapter } from './protocol-adapter.js';

/** Minimum confidence above which a detection is accepted (06 §2.3 threshold). */
export const DETECTION_THRESHOLD = 0.5;

export interface RegistryEntry {
  readonly adapter: ProtocolAdapter;
  enabled: boolean;
  /** True for out-of-tree (dynamically loaded) adapters, false for built-in. */
  readonly dynamic: boolean;
}

export interface AdapterStats {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly dynamic: boolean;
  readonly transport: string;
  readonly defaultPort: number;
}

export class AdapterRegistry {
  private readonly logger = new Logger(AdapterRegistry.name);
  private readonly entries = new Map<string, RegistryEntry>();

  /** Register a built-in or dynamically-loaded adapter (idempotent on id). */
  public register(adapter: ProtocolAdapter, dynamic = false): void {
    const existing = this.entries.get(adapter.id);
    if (existing) {
      // Hot reload: replace the adapter implementation, keep enablement + dynamic flag.
      this.entries.set(adapter.id, { adapter, enabled: existing.enabled, dynamic });
      this.logger.log(`Replaced adapter '${adapter.id}' (hot reload).`);
      return;
    }
    this.entries.set(adapter.id, { adapter, enabled: true, dynamic });
    this.logger.log(
      `Registered adapter '${adapter.id}' (${adapter.meta.name}) [${dynamic ? 'plugin' : 'built-in'}].`,
    );
  }

  /** Remove an adapter (used on plugin unload). No-op if absent. */
  public unregister(id: string): boolean {
    const removed = this.entries.delete(id);
    if (removed) this.logger.log(`Unregistered adapter '${id}'.`);
    return removed;
  }

  /** Get an enabled adapter by id, or null. */
  public get(id: string): ProtocolAdapter | null {
    const entry = this.entries.get(id);
    return entry?.enabled ? entry.adapter : null;
  }

  /** Get an adapter by id regardless of enablement (admin introspection). */
  public getAny(id: string): ProtocolAdapter | null {
    return this.entries.get(id)?.adapter ?? null;
  }

  /** Enable/disable an adapter (06 §9.4 hot reload). */
  public setEnabled(id: string, enabled: boolean): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.enabled = enabled;
    this.logger.log(`Adapter '${id}' ${enabled ? 'enabled' : 'disabled'}.`);
    return true;
  }

  /** All currently enabled adapters. */
  public enabled(): readonly ProtocolAdapter[] {
    return [...this.entries.values()].filter((e) => e.enabled).map((e) => e.adapter);
  }

  /** All registered adapters (enabled or not) — for the admin API. */
  public list(): readonly AdapterStats[] {
    return [...this.entries.values()].map((e) => ({
      id: e.adapter.id,
      name: e.adapter.meta.name,
      enabled: e.enabled,
      dynamic: e.dynamic,
      transport: e.adapter.meta.transport,
      defaultPort: e.adapter.meta.defaultPort,
    }));
  }

  /**
   * Detect the best-matching adapter for a peek of inbound bytes on a
   * multiplexed listener (06 §2.3). Returns the highest-confidence enabled
   * adapter above the threshold, or null if none match.
   */
  public detect(peek: Buffer): ProtocolAdapter | null {
    let best: { adapter: ProtocolAdapter; confidence: number } | null = null;
    for (const entry of this.entries.values()) {
      if (!entry.enabled) continue;
      const result = entry.adapter.detect(peek);
      if (result.confidence > (best?.confidence ?? -1)) {
        best = { adapter: entry.adapter, confidence: result.confidence };
      }
    }
    if (best && best.confidence >= DETECTION_THRESHOLD) {
      return best.adapter;
    }
    return null;
  }

  /**
   * Require an adapter by id, throwing a ProtocolError if it is absent/disabled.
   * Used by dedicated listeners where the protocol is known by configuration.
   */
  public require(id: string): ProtocolAdapter {
    const adapter = this.get(id);
    if (!adapter) {
      throw new ProtocolError(`Adapter '${id}' is not registered or enabled.`, id);
    }
    return adapter;
  }
}
