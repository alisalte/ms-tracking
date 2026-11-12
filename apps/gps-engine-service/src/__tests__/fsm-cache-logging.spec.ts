import { describe, expect, it, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { RedisFsmCache } from '../infrastructure/cache/redis-fsm-cache.js';

const down = () => ({
  get: async () => {
    throw new Error('redis down');
  },
  set: async () => {
    throw new Error('redis down');
  },
});

describe('RedisFsmCache failures are visible', () => {
  it('logs a Redis outage instead of swallowing it, and still degrades to defaults', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const cache = new RedisFsmCache(down() as never, () => 1_000_000);
    expect(await cache.get('t', 'v', 'tripfsm')).toBeNull();
    expect(await cache.getNumber('t', 'v', 'odo')).toBe(0);
    await expect(cache.set('t', 'v', 'tripfsm', { state: 'MOVING' })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('redis down');
    warn.mockRestore();
  });

  it('logs at most once per minute, then reports how many failures it skipped', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    let now = 1_000_000;
    const cache = new RedisFsmCache(down() as never, () => now);
    for (let i = 0; i < 5; i++) await cache.get('t', 'v', 'tripfsm');
    expect(warn).toHaveBeenCalledTimes(1);
    now += 61_000;
    await cache.get('t', 'v', 'tripfsm');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[1]?.[0])).toContain('5 failure(s)');
    warn.mockRestore();
  });

  it('stays quiet when Redis works', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const store = new Map<string, string>();
    const redis = {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => {
        store.set(k, v);
        return 'OK';
      },
    };
    const cache = new RedisFsmCache(redis as never);
    await cache.set('t', 'v', 'tripfsm', { state: 'MOVING' });
    expect(await cache.get('t', 'v', 'tripfsm')).toEqual({ state: 'MOVING' });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
