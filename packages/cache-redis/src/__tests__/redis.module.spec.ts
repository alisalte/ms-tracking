import { afterAll, describe, expect, it } from '@jest/globals';
import type { Redis } from 'ioredis';
import { REDIS_TOKEN, RedisModule, createRedisClient } from '../index.js';

// Both tests construct a real ioredis client; close them in afterAll so Jest
// exits without dangling-socket warnings.
const clients: Redis[] = [];

afterAll(async () => {
  for (const c of clients) {
    c.disconnect();
  }
});

describe('RedisModule.forRoot', () => {
  it('registers a global module that exports the REDIS_TOKEN client', () => {
    const mod = RedisModule.forRoot({
      url: 'redis://localhost:6379/15',
      connectTimeoutMillis: 100,
    });
    // Pull the constructed client out of the provider so we can tear it down.
    const clientProvider = mod.providers?.find(
      (p) => (p as { provide?: unknown }).provide === REDIS_TOKEN,
    ) as { provide: string; useValue: Redis } | undefined;
    if (clientProvider) {
      clients.push(clientProvider.useValue);
    }

    expect(mod.global).toBe(true);
    expect(clientProvider).toBeDefined();
    expect(mod.exports?.includes(REDIS_TOKEN)).toBe(true);
  });
});

describe('createRedisClient', () => {
  it('constructs without throwing and surfaces errors (not crashes) on a dead backend', async () => {
    const client = createRedisClient({ url: 'redis://localhost:1/0', connectTimeoutMillis: 100 });
    clients.push(client);
    expect(typeof client.ping).toBe('function');
    // The client's 'error' handler swallows errors; await a tick so the failed
    // connection event fires harmlessly rather than crashing the process.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});
