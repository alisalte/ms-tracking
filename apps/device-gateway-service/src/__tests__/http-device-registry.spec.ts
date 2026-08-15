import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { HttpDeviceRegistry } from '../infrastructure/registry/http-device-registry.js';

/** Stub global fetch with a per-test responder. */
function stubFetch(responder: (url: string) => { status: number; body: unknown }): void {
  const fakeFetch: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : String(input);
    const { status, body } = responder(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  };
  globalThis.fetch = fakeFetch;
}

describe('HttpDeviceRegistry (Sprint C §17/§18/§22/§7.3)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    stubFetch(() => ({ status: 404, body: { found: false } }));
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('resolves a known ACTIVE device to trusted identity and stashes tenantActive', async () => {
    let calledUrl = '';
    stubFetch((url) => {
      calledUrl = url;
      return {
        status: 200,
        body: {
          found: true,
          tenantActive: true,
          device: {
            deviceId: 'dev-1',
            tenantId: 'tenant-1',
            status: 'ACTIVE',
            protocol: 'gt06',
            vehicleId: 'veh-1',
          },
        },
      };
    });
    const registry = new HttpDeviceRegistry({
      baseUrl: 'http://localhost:3006/',
      apiKey: 'fv_test_key',
    });
    const res = await registry.resolve('351234567890124');
    expect(res.found).toBe(true);
    if (res.found) {
      expect(res.device).toEqual({
        deviceId: 'dev-1',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        pairedVehicleId: 'veh-1',
      });
    }
    expect(calledUrl).toContain('/api/v1/devices/resolve?imei=351234567890124');
    // tenantActive stashed during resolve():
    await expect(registry.tenantActive('tenant-1')).resolves.toBe(true);
  });

  it('returns found:false for an unknown device (404)', async () => {
    const registry = new HttpDeviceRegistry({ baseUrl: 'http://localhost:3006', apiKey: 'k' });
    await expect(registry.resolve('nope')).resolves.toEqual({ found: false });
  });

  it('passes through a SUSPENDED device (the AuthResolver maps status→disabled)', async () => {
    stubFetch(() => ({
      status: 200,
      body: {
        found: true,
        tenantActive: true,
        device: { deviceId: 'd', tenantId: 't', status: 'SUSPENDED', vehicleId: null },
      },
    }));
    const registry = new HttpDeviceRegistry({ baseUrl: 'http://localhost:3006', apiKey: 'k' });
    const res = await registry.resolve('imei');
    expect(res.found).toBe(true);
    if (res.found) expect(res.device.status).toBe('SUSPENDED');
  });

  it('fail-closes on a non-2xx response (HTTP 500 → unknown → reject)', async () => {
    stubFetch(() => ({ status: 500, body: {} }));
    const registry = new HttpDeviceRegistry({ baseUrl: 'http://localhost:3006', apiKey: 'k' });
    await expect(registry.resolve('imei')).resolves.toEqual({ found: false });
  });

  it('fail-closes on a network error', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const registry = new HttpDeviceRegistry({ baseUrl: 'http://localhost:3006', apiKey: 'k' });
    await expect(registry.resolve('imei')).resolves.toEqual({ found: false });
  });

  it('fail-closes when no API key is configured', async () => {
    const registry = new HttpDeviceRegistry({ baseUrl: 'http://localhost:3006', apiKey: '' });
    await expect(registry.resolve('imei')).resolves.toEqual({ found: false });
  });

  it('tenantActive defaults fail-safe (false) for an unseen tenant', async () => {
    const registry = new HttpDeviceRegistry({ baseUrl: 'http://localhost:3006', apiKey: 'k' });
    await expect(registry.tenantActive('never-seen')).resolves.toBe(false);
  });
});
