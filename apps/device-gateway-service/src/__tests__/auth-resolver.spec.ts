import { beforeEach, describe, expect, it } from '@jest/globals';
import { AuthResolver } from '../application/auth-resolver.js';
import {
  type DeviceRegistry,
  InMemoryDeviceRegistry,
  type ResolvedDevice,
} from '../infrastructure/registry/index.js';

/** Minimal Redis-like stub implementing only the get/set/del the resolver uses. */
class FakeRedis {
  private store = new Map<string, string>();
  async get(k: string): Promise<string | null> {
    return this.store.get(k) ?? null;
  }
  async set(k: string, v: string, _mode?: string, _ttl?: number): Promise<string> {
    this.store.set(k, v);
    return 'OK';
  }
  async del(k: string): Promise<number> {
    return this.store.delete(k) ? 1 : 0;
  }
}

const activeDevice: ResolvedDevice = {
  deviceId: 'dev-1',
  tenantId: 'tenant-1',
  status: 'ACTIVE',
  pairedVehicleId: 'veh-1',
};

describe('AuthResolver — 3-tier ladder (06 §7)', () => {
  let registry: InMemoryDeviceRegistry;
  let redis: FakeRedis;

  beforeEach(() => {
    registry = new InMemoryDeviceRegistry();
    redis = new FakeRedis();
  });

  it('resolves an ACTIVE device via L3 and caches it in L2', async () => {
    registry.registerByImei('imei-1', activeDevice);
    const resolver = new AuthResolver(redis as never, registry);
    const out = await resolver.resolve('imei-1');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.device.deviceId).toBe('dev-1');
      expect(out.device.tenantId).toBe('tenant-1');
    }
    // L2 should now be populated.
    const l2 = await redis.get('auth:device:imei:imei-1');
    expect(l2).toContain('dev-1');
  });

  it('serves a second resolve from L1 (no L3 call count needed)', async () => {
    registry.registerByImei('imei-2', activeDevice);
    let l3calls = 0;
    const wrappedRegistry: DeviceRegistry = {
      async resolve(imei) {
        l3calls++;
        return registry.resolve(imei);
      },
      async tenantActive(t) {
        return registry.tenantActive(t);
      },
    };
    const resolver = new AuthResolver(redis as never, wrappedRegistry);
    await resolver.resolve('imei-2'); // L3 + cache
    const firstCalls = l3calls;
    await resolver.resolve('imei-2'); // should hit L1
    expect(l3calls).toBe(firstCalls); // no additional L3 call
  });

  it('returns ok:false reason:unknown when the device is not in the registry', async () => {
    const resolver = new AuthResolver(redis as never, registry);
    const out = await resolver.resolve('no-such-imei');
    expect(out).toEqual({ ok: false, reason: 'unknown' });
  });

  it('returns ok:false reason:disabled for a SUSPENDED device (06 §7.3)', async () => {
    registry.registerByImei('imei-3', { ...activeDevice, deviceId: 'd3', status: 'SUSPENDED' });
    const resolver = new AuthResolver(redis as never, registry);
    const out = await resolver.resolve('imei-3');
    expect(out).toEqual({ ok: false, reason: 'disabled' });
  });

  it('returns ok:false reason:tenant_suspended when the tenant is not active', async () => {
    registry.registerByImei('imei-4', { ...activeDevice, deviceId: 'd4' }, false);
    const resolver = new AuthResolver(redis as never, registry);
    const out = await resolver.resolve('imei-4');
    expect(out).toEqual({ ok: false, reason: 'tenant_suspended' });
  });

  it('degrades gracefully when Redis is unavailable (null) — still resolves via L3', async () => {
    registry.registerByImei('imei-5', { ...activeDevice, deviceId: 'd5' });
    const resolver = new AuthResolver(null, registry);
    const out = await resolver.resolve('imei-5');
    expect(out.ok).toBe(true);
  });

  it('invalidate clears L1 so the next resolve re-hits L3', async () => {
    registry.registerByImei('imei-6', { ...activeDevice, deviceId: 'd6' });
    let l3calls = 0;
    const wrappedRegistry: DeviceRegistry = {
      async resolve(imei) {
        l3calls++;
        return registry.resolve(imei);
      },
      async tenantActive(t) {
        return registry.tenantActive(t);
      },
    };
    const resolver = new AuthResolver(redis as never, wrappedRegistry);
    await resolver.resolve('imei-6');
    const before = l3calls;
    resolver.invalidate('imei-6');
    await resolver.resolve('imei-6'); // L1 cleared → must re-resolve
    expect(l3calls).toBe(before + 1);
  });
});
