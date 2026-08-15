import { afterEach, describe, expect, it } from '@jest/globals';
import { AuthResolver } from '../application/auth-resolver.js';
import type {
  DeviceRegistry,
  Resolution,
} from '../infrastructure/registry/device-registry.port.js';
import { HttpDeviceRegistry } from '../infrastructure/registry/http-device-registry.js';
import {
  REGISTRY_INVALIDATION_CHANNEL,
  RegistryInvalidationSubscriber,
} from '../infrastructure/registry/index.js';

/**
 * Sprint D §12 — HttpDeviceRegistry bounded retry/backoff, and Sprint D §11 —
 * push-based registry-cache invalidation over Redis pub/sub.
 */

/** Stub global fetch with a per-test responder queue. */
function stubFetchQueue(responses: { status: number; body: unknown }[]): {
  calls: number;
} {
  const state = { calls: 0 };
  const fakeFetch: typeof fetch = async () => {
    const next = responses[Math.min(state.calls, responses.length - 1)];
    if (!next) throw new Error('no queued response');
    state.calls++;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
    } as Response;
  };
  globalThis.fetch = fakeFetch;
  return state;
}

function stubFetch(responder: () => { status: number; body: unknown }): { calls: number } {
  const state = { calls: 0 };
  const fakeFetch: typeof fetch = async () => {
    const next = responder();
    state.calls++;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
    } as Response;
  };
  globalThis.fetch = fakeFetch;
  return state;
}

describe('Sprint D §12 — HttpDeviceRegistry bounded retries', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('retries a 503 and succeeds on the second attempt', async () => {
    const state = stubFetchQueue([
      { status: 503, body: {} },
      {
        status: 200,
        body: {
          found: true,
          tenantActive: true,
          device: { deviceId: 'd', tenantId: 't', status: 'ACTIVE', vehicleId: 'v-1' },
        },
      },
    ]);
    const registry = new HttpDeviceRegistry({
      baseUrl: 'http://localhost:3006',
      apiKey: 'k',
      maxRetries: 2,
      retryBackoffMs: 1,
    });
    const res = await registry.resolve('imei');
    expect(res.found).toBe(true);
    expect(state.calls).toBe(2);
  });

  it('retries a 429 (rate-limit) as transient, then succeeds', async () => {
    const state = stubFetchQueue([
      { status: 429, body: {} },
      {
        status: 200,
        body: {
          found: true,
          tenantActive: true,
          device: { deviceId: 'd', tenantId: 't', status: 'ACTIVE', vehicleId: null },
        },
      },
    ]);
    const registry = new HttpDeviceRegistry({
      baseUrl: 'http://localhost:3006',
      apiKey: 'k',
      maxRetries: 1,
      retryBackoffMs: 1,
    });
    const res = await registry.resolve('imei');
    expect(res.found).toBe(true);
    expect(state.calls).toBe(2);
  });

  it('does NOT retry a 404 (unknown device is a final answer)', async () => {
    const state = stubFetch(() => ({ status: 404, body: { found: false } }));
    const registry = new HttpDeviceRegistry({
      baseUrl: 'http://localhost:3006',
      apiKey: 'k',
      maxRetries: 3,
      retryBackoffMs: 1,
    });
    await expect(registry.resolve('imei')).resolves.toEqual({ found: false });
    expect(state.calls).toBe(1);
  });

  it('does NOT retry a 403 (config error is not transient)', async () => {
    const state = stubFetch(() => ({ status: 403, body: {} }));
    const registry = new HttpDeviceRegistry({
      baseUrl: 'http://localhost:3006',
      apiKey: 'k',
      maxRetries: 3,
      retryBackoffMs: 1,
    });
    await expect(registry.resolve('imei')).resolves.toEqual({ found: false });
    expect(state.calls).toBe(1);
  });

  it('exhausts retries on persistent network errors → fail-closed (bounded attempts)', async () => {
    const state = { calls: 0 };
    globalThis.fetch = (async () => {
      state.calls++;
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const registry = new HttpDeviceRegistry({
      baseUrl: 'http://localhost:3006',
      apiKey: 'k',
      maxRetries: 2,
      retryBackoffMs: 1,
    });
    await expect(registry.resolve('imei')).resolves.toEqual({ found: false });
    expect(state.calls).toBe(3); // 1 initial + 2 retries — bounded, no infinite loop.
  });

  it('tenantActive entries expire (TTL-bounded, no permanent stash)', async () => {
    stubFetch(() => ({
      status: 200,
      body: {
        found: true,
        tenantActive: true,
        device: { deviceId: 'd', tenantId: 't', status: 'ACTIVE', vehicleId: null },
      },
    }));
    const registry = new HttpDeviceRegistry({
      baseUrl: 'http://localhost:3006',
      apiKey: 'k',
      maxRetries: 0,
    });
    await registry.resolve('imei');
    await expect(registry.tenantActive('t')).resolves.toBe(true);
    // Advance well past the 5-minute TTL.
    const realNow = Date.now;
    Date.now = () => realNow() + 6 * 60 * 1000;
    try {
      await expect(registry.tenantActive('t')).resolves.toBe(false);
    } finally {
      Date.now = realNow;
    }
  });
});

/** Minimal fake Redis with ioredis-compatible pub/sub semantics. */
class FakeRedis {
  public handlers = new Map<string, ((channel: string, message: string) => void)[]>();
  public published: { channel: string; message: string }[] = [];
  public failSubscribe = false;

  /** ioredis-style event registration ('message' → (channel, message)). */
  public on(event: string, handler: (channel: string, message: string) => void): void {
    if (event !== 'message') return;
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  /** ioredis-style duplicate(): a second connection to the same (fake) server. */
  public duplicate(): FakeRedis {
    return this;
  }

  async subscribe(channel: string): Promise<number> {
    if (this.failSubscribe) throw new Error('redis down');
    void channel;
    return 1;
  }

  async publish(channel: string, message: string): Promise<number> {
    this.published.push({ channel, message });
    let count = 0;
    for (const handler of this.handlers.get('message') ?? []) {
      handler(channel, message);
      count++;
    }
    return count;
  }

  async unsubscribe(): Promise<void> {}
  async quit(): Promise<void> {}
}

describe('Sprint D §11 — registry cache invalidation (Redis pub/sub)', () => {
  class StaticRegistry implements DeviceRegistry {
    public constructor(public device: Resolution) {}
    async resolve(): Promise<Resolution> {
      return this.device;
    }
    async tenantActive(): Promise<boolean> {
      return true;
    }
  }

  it('an invalidation message clears the resolver cache immediately', async () => {
    const redis = new FakeRedis();
    const activeDevice: Resolution = {
      found: true,
      device: { deviceId: 'd', tenantId: 't', status: 'ACTIVE', pairedVehicleId: null },
    };
    const registry = new StaticRegistry(activeDevice);
    const resolver = new AuthResolver(null, registry);
    const subscriber = new RegistryInvalidationSubscriber(redis as never, resolver);
    await subscriber.start();

    // Prime the L1 cache.
    await expect(resolver.resolve('imei-1')).resolves.toMatchObject({ ok: true });

    // Disable the device at the source, then publish the invalidation.
    registry.device = { found: false };
    await redis.publish(
      REGISTRY_INVALIDATION_CHANNEL,
      JSON.stringify({ imei: 'imei-1', reason: 'device.status-changed' }),
    );

    // The next resolve sees the fresh (disabled) truth — no TTL wait.
    await expect(resolver.resolve('imei-1')).resolves.toEqual({
      ok: false,
      reason: 'unknown',
    });
    await subscriber.onApplicationShutdown();
  });

  it('malformed invalidation payloads are ignored (no crash, no invalidation)', async () => {
    const redis = new FakeRedis();
    const registry = new StaticRegistry({
      found: true,
      device: { deviceId: 'd', tenantId: 't', status: 'ACTIVE', pairedVehicleId: null },
    });
    const resolver = new AuthResolver(null, registry);
    const subscriber = new RegistryInvalidationSubscriber(redis as never, resolver);
    await subscriber.start();
    await expect(resolver.resolve('imei-2')).resolves.toMatchObject({ ok: true });

    await redis.publish(REGISTRY_INVALIDATION_CHANNEL, 'not-json{');
    await redis.publish(REGISTRY_INVALIDATION_CHANNEL, JSON.stringify({ imei: '' }));

    // Cache still holds the good entry.
    await expect(resolver.resolve('imei-2')).resolves.toMatchObject({ ok: true });
    await subscriber.onApplicationShutdown();
  });

  it('subscriber start tolerates a Redis outage (TTL-only degradation)', async () => {
    const redis = new FakeRedis();
    redis.failSubscribe = true;
    const resolver = new AuthResolver(null, new StaticRegistry({ found: false }));
    const subscriber = new RegistryInvalidationSubscriber(redis as never, resolver);
    await expect(subscriber.start()).resolves.toBeUndefined();
  });
});
