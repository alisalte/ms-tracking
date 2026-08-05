import type { Redis } from '@fleetvision/cache-redis';
/**
 * AuthResolver — device resolution with a 3-tier cache ladder (06 §7).
 *
 *   L1 — local LRU (in-process, ~30s): hottest devices, sub-millisecond (06 §7.2).
 *   L2 — Redis (tenant:<tid>:device:<did>:auth, TTL 5m): cross-pod cache.
 *   L3 — DeviceRegistry (gRPC to device-management-service in prod): source of truth.
 *
 * Cache miss at L3 = unknown device → reject and close (06 §7.2). Fail-closed:
 * if L3 is unreachable AND there is no L1/L2 entry, the gateway does NOT accept
 * the device untrusted (06 §7.3). Cache entries are invalidated on
 * disable/decommission via the device.provisioned event (06 §7.2).
 *
 * L2 is optional (Redis may be down — circuit-break); L1 still serves. This
 * mirrors the resilient pattern of the identity-service auth path.
 */
import { Logger } from '@nestjs/common';
import type {
  DeviceRegistry,
  ResolvedDevice,
} from '../infrastructure/registry/device-registry.port.js';

/** L2 Redis value (06 §16.1 `tenant:<tid>:device:<did>:auth`). */
interface AuthCacheValue {
  readonly deviceId: string;
  readonly tenantId: string;
  readonly status: string;
  readonly pairedVehicleId: string | null;
}

export interface AuthResolverOptions {
  /** L1 LRU size (hottest devices kept in-process). */
  readonly l1MaxEntries: number;
  /** L1 TTL (ms) — 06 §7.2 says ~30s. */
  readonly l1TtlMs: number;
  /** L2 Redis TTL (seconds) — 06 §7.2 says 5m. */
  readonly l2TtlSeconds: number;
}

const DEFAULT_OPTIONS: AuthResolverOptions = {
  l1MaxEntries: 10_000,
  l1TtlMs: 30_000,
  l2TtlSeconds: 300,
};

/** The auth resolution outcome the dispatcher acts on. */
export type AuthOutcome =
  | { readonly ok: true; readonly device: ResolvedDevice }
  | { readonly ok: false; readonly reason: 'unknown' | 'disabled' | 'tenant_suspended' };

export class AuthResolver {
  private readonly logger = new Logger(AuthResolver.name);
  private readonly l1 = new LruCache<string, { device: ResolvedDevice; expiresAt: number }>(
    DEFAULT_OPTIONS.l1MaxEntries,
  );
  private readonly options: AuthResolverOptions;

  constructor(
    /** L2 (Redis). Optional — resolver degrades to L1+L3 when null/unreachable. */
    private readonly redis: Redis | null,
    /** L3 — the durable registry (gRPC in prod; in-memory in Sprint 3). */
    private readonly registry: DeviceRegistry,
    options: Partial<AuthResolverOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Resolve a serial/IMEI to a device identity. Walks L1 → L2 → L3, caching
   * upward on a miss. Returns an AuthOutcome; never throws — failure modes are
   * mapped to outcome reasons (06 §7.3) so the caller closes cleanly.
   */
  public async resolve(serialOrImei: string): Promise<AuthOutcome> {
    // L1.
    const l1Hit = this.l1.get(serialOrImei);
    if (l1Hit && l1Hit.expiresAt > Date.now() && l1Hit.device.status === 'ACTIVE') {
      return { ok: true, device: l1Hit.device };
    }

    // L2 (best-effort; Redis down → skip).
    const l2Hit = await this.l2get(serialOrImei);
    if (l2Hit) {
      const device = this.fromCacheValue(l2Hit);
      this.l1.set(serialOrImei, { device, expiresAt: Date.now() + this.options.l1TtlMs });
      return this.checkEnabled(device);
    }

    // L3 (source of truth).
    const resolution = await this.resolveL3(serialOrImei);
    if (!resolution.found) {
      return { ok: false, reason: 'unknown' };
    }
    const device = resolution.device;
    // Tenant-status check (06 §7.3 — tenant suspended → close).
    const tenantActive = await this.registry.tenantActive(device.tenantId);
    if (!tenantActive) {
      return { ok: false, reason: 'tenant_suspended' };
    }
    // Cache upward (best-effort; only ACTIVE devices stay in cache).
    if (device.status === 'ACTIVE') {
      this.l1.set(serialOrImei, { device, expiresAt: Date.now() + this.options.l1TtlMs });
      await this.l2set(serialOrImei, device);
    }
    return this.checkEnabled(device);
  }

  /** Invalidate L1 (and L2 best-effort) — called on device.provisioned disable. */
  public invalidate(serialOrImei: string): void {
    this.l1.delete(serialOrImei);
    void this.l2del(serialOrImei);
  }

  private async resolveL3(serialOrImei: string) {
    try {
      return await this.registry.resolve(serialOrImei);
    } catch (err) {
      // L3 unreachable — fail-safe close (06 §7.3).
      this.logger.warn(`L3 registry unreachable: ${(err as Error).message} — fail-closed.`);
      return { found: false } as const;
    }
  }

  private checkEnabled(device: ResolvedDevice): AuthOutcome {
    if (device.status === 'SUSPENDED' || device.status === 'DECOMMISSIONED') {
      return { ok: false, reason: 'disabled' };
    }
    return { ok: true, device };
  }

  private fromCacheValue(v: AuthCacheValue): ResolvedDevice {
    return {
      deviceId: v.deviceId,
      tenantId: v.tenantId,
      status: v.status as ResolvedDevice['status'],
      pairedVehicleId: v.pairedVehicleId,
    };
  }

  private l2key(imei: string): string {
    return `auth:device:imei:${imei}`; // L2 is cross-tenant IMEI lookup (pre-resolve).
  }

  private async l2get(imei: string): Promise<AuthCacheValue | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(this.l2key(imei));
      if (!raw) return null;
      return JSON.parse(raw) as AuthCacheValue;
    } catch (err) {
      this.logger.warn(`L2 auth read failed: ${(err as Error).message} — degrading to L1/L3.`);
      return null;
    }
  }

  private async l2set(imei: string, device: ResolvedDevice): Promise<void> {
    if (!this.redis) return;
    try {
      const value: AuthCacheValue = {
        deviceId: device.deviceId,
        tenantId: device.tenantId,
        status: device.status,
        pairedVehicleId: device.pairedVehicleId,
      };
      await this.redis.set(
        this.l2key(imei),
        JSON.stringify(value),
        'EX',
        this.options.l2TtlSeconds,
      );
    } catch (err) {
      this.logger.warn(
        `L2 auth write failed: ${(err as Error).message} — continuing (best-effort).`,
      );
    }
  }

  private async l2del(imei: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(this.l2key(imei));
    } catch {
      /* best-effort */
    }
  }
}

/** Tiny LRU with TTL. O(1) get/set; evicts least-recently-used at capacity. */
class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly max: number) {}

  public get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Refresh recency (Map preserves insertion order).
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  public set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const firstKey = this.map.keys().next().value;
      if (firstKey === undefined) break;
      this.map.delete(firstKey);
    }
  }

  public delete(key: K): void {
    this.map.delete(key);
  }

  public get size(): number {
    return this.map.size;
  }
}

/** Re-exported for callers constructing the resolver. */
