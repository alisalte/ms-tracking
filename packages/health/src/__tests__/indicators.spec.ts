import { describe, expect, it } from '@jest/globals';
import { HealthCheckError } from '@nestjs/terminus';
import { KnexPingIndicator } from '../knex-ping.indicator.js';
import { RedisPingIndicator } from '../redis-ping.indicator.js';

describe('KnexPingIndicator', () => {
  it('reports healthy when SELECT 1 succeeds', async () => {
    const fakeKnex = { raw: async () => [{ ok: 1 }] };
    const indicator = new KnexPingIndicator(fakeKnex as never);
    const result = await indicator.isHealthy();
    expect(result[indicator.name]).toEqual({ status: 'up' });
  });

  it('throws HealthCheckError when the ping fails', async () => {
    const fakeKnex = {
      raw: async () => {
        throw new Error('connection refused');
      },
    };
    const indicator = new KnexPingIndicator(fakeKnex as never);
    await expect(indicator.isHealthy()).rejects.toBeInstanceOf(HealthCheckError);
  });

  it('reports healthy+skipped when no knex client is bound', async () => {
    const indicator = new KnexPingIndicator(null);
    const result = await indicator.isHealthy();
    expect(result[indicator.name]?.status).toBe('up');
  });
});

describe('RedisPingIndicator', () => {
  it('reports healthy when PING returns PONG', async () => {
    const fakeRedis = { ping: async () => 'PONG' };
    const indicator = new RedisPingIndicator(fakeRedis as never);
    const result = await indicator.isHealthy();
    expect(result[indicator.name]?.status).toBe('up');
  });

  it('throws HealthCheckError when the ping fails', async () => {
    const fakeRedis = {
      ping: async () => {
        throw new Error('ECONNREFUSED');
      },
    };
    const indicator = new RedisPingIndicator(fakeRedis as never);
    await expect(indicator.isHealthy()).rejects.toBeInstanceOf(HealthCheckError);
  });
});
