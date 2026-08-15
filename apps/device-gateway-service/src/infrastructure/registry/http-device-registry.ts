/**
 * HttpDeviceRegistry — the production `DeviceRegistry` implementation.
 *
 * Resolves an IMEI to trusted device identity by calling fleet-management-service's
 * `/api/v1/devices/resolve` endpoint over HTTP. The gateway therefore NEVER knows
 * fleet-management's database schema (Sprint C §17) — it depends only on the
 * `DeviceRegistry` port + the resolve response contract.
 *
 * Performance (§22): this is the auth-resolver's L3, reached ONLY on an L1+L2 cache
 * miss (L1 ~30s, L2 Redis ~5min). A hot device never hits HTTP here — roughly one
 * call per device per five minutes, never per packet. The response's `tenantActive`
 * is stashed so the port's separate `tenantActive()` call (made immediately after
 * `resolve()` on the L3 path) needs no second round-trip.
 *
 * Fail-closed (§7.3): any error — network, timeout, non-2xx, malformed body, or a
 * missing API key — yields `{ found: false }` (→ unknown device → reject + close).
 */
import { Logger } from '@nestjs/common';
import type { DeviceRegistry, Resolution, ResolvedDevice } from './device-registry.port.js';

/** Parsed shape of the fleet-management resolve response. */
interface ResolveResponse {
  readonly found: boolean;
  readonly tenantActive: boolean;
  readonly device?: {
    readonly deviceId: string;
    readonly tenantId: string;
    readonly status: string;
    readonly protocol?: string;
    readonly vehicleId?: string | null;
  };
}

export interface HttpDeviceRegistryOptions {
  /** Base URL of fleet-management-service (e.g. http://localhost:3006). */
  readonly baseUrl: string;
  /** Service API key carrying `device.registry.resolve` (X-API-Key). */
  readonly apiKey: string;
  /** Request timeout (ms). */
  readonly timeoutMs?: number;
  /** Bounded retry attempts for TRANSIENT failures (Sprint D §12). */
  readonly maxRetries?: number;
  /** Initial retry backoff (ms) — doubled each attempt. */
  readonly retryBackoffMs?: number;
}

/** Classify an HTTP status as a transient (retryable) failure (§12). */
function isTransientStatus(status: number): boolean {
  // 429 rate-limit + 5xx server faults are the only retryable outcomes.
  // 404 = unknown device (no retry), 401/403 = bad key (no retry — config error).
  return status === 429 || (status >= 500 && status <= 599);
}

const TENANT_ACTIVE_TTL_MS = 5 * 60 * 1000;

interface TenantActiveEntry {
  readonly value: boolean;
  readonly expiresAt: number;
}

export class HttpDeviceRegistry implements DeviceRegistry {
  private readonly logger = new Logger('HttpDeviceRegistry');
  /** tenantActive stashed during resolve() with a TTL (§12 — bounded memory). */
  private readonly tenantActiveCache = new Map<string, TenantActiveEntry>();
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;

  constructor(opts: HttpDeviceRegistryOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 3_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.retryBackoffMs = opts.retryBackoffMs ?? 250;
  }

  public async resolve(serialOrImei: string): Promise<Resolution> {
    if (!this.apiKey) {
      this.logger.warn('No FLEET_REGISTRY_API_KEY configured — cannot resolve (fail-closed).');
      return { found: false };
    }
    const url = `${this.baseUrl}/api/v1/devices/resolve?imei=${encodeURIComponent(serialOrImei)}`;
    // Sprint D §12 — bounded retries with exponential backoff on TRANSIENT
    // failures only (429 / 5xx / network / timeout). 404 stays found:false, and
    // 401/403 stay fail-closed (they are config errors, not transient).
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = this.retryBackoffMs * 2 ** (attempt - 1);
        await sleep(backoff);
      }
      try {
        const outcome = await this.resolveOnce(url, serialOrImei);
        if (outcome.kind === 'result') return outcome.value;
        if (!outcome.transient) return { found: false };
        lastError = new Error(`HTTP ${outcome.status}`);
      } catch (err) {
        lastError = err as Error;
      }
    }
    this.logger.warn(
      `fleet resolve exhausted retries for imei=${serialOrImei}: ${lastError?.message} — fail-closed.`,
    );
    return { found: false };
  }

  private async resolveOnce(
    url: string,
    serialOrImei: string,
  ): Promise<
    | { readonly kind: 'result'; readonly value: Resolution }
    | { readonly kind: 'retry'; readonly status: number; readonly transient: boolean }
  > {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'X-API-Key': this.apiKey, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (res.status === 404) return { kind: 'result', value: { found: false } };
      if (!res.ok) {
        if (isTransientStatus(res.status)) {
          return { kind: 'retry', status: res.status, transient: true };
        }
        this.logger.warn(
          `fleet resolve HTTP ${res.status} for imei=${serialOrImei} — fail-closed (non-retryable).`,
        );
        return { kind: 'retry', status: res.status, transient: false };
      }
      const body = (await res.json()) as ResolveResponse;
      if (!body.found || !body.device) {
        if (body.device === undefined && body.found) {
          this.logger.warn('fleet resolve found=true but no device body — fail-closed.');
        }
        return { kind: 'result', value: { found: false } };
      }
      const d = body.device;
      const device: ResolvedDevice = {
        deviceId: d.deviceId,
        tenantId: d.tenantId,
        status: d.status as ResolvedDevice['status'],
        pairedVehicleId: d.vehicleId ?? null,
      };
      this.cacheTenantActive(d.tenantId, body.tenantActive === true);
      return { kind: 'result', value: { found: true, device } };
    } catch (err) {
      // Network/abort/JSON errors are transient — the retry loop decides.
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  public async tenantActive(tenantId: string): Promise<boolean> {
    const entry = this.tenantActiveCache.get(tenantId);
    if (!entry) return false; // fail-safe (unknown tenant rejects).
    if (Date.now() >= entry.expiresAt) {
      this.tenantActiveCache.delete(tenantId);
      return false;
    }
    return entry.value;
  }

  private cacheTenantActive(tenantId: string, value: boolean): void {
    this.tenantActiveCache.set(tenantId, { value, expiresAt: Date.now() + TENANT_ACTIVE_TTL_MS });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
