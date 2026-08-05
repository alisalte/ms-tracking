import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';
import { baseConfigSchema } from '../base-config.js';
import { CONFIG_TOKEN, ConfigModule } from '../index.js';

/**
 * A service config schema that extends the base — the shape identity-service
 * will use. Keys must match the env var names (zod reads process.env literally).
 */
const schema = baseConfigSchema.merge(
  z.object({
    DBURL: z.string().min(1),
    REDISURL: z.string().min(1),
  }),
);

describe('ConfigModule', () => {
  it('validates a valid config and provides it', () => {
    const mod = ConfigModule.forRoot({
      schema,
      serviceName: 'test-service',
      env: {
        PORT: '3000',
        HOST: '0.0.0.0',
        LOG_LEVEL: 'info',
        ENVIRONMENT: 'local',
        DBURL: 'postgres://localhost/db',
        REDISURL: 'redis://localhost',
      },
    });
    expect(mod.global).toBe(true);
    expect(
      mod.providers?.some((p) => {
        const provider = p as { provide?: unknown };
        return provider.provide === CONFIG_TOKEN;
      }),
    ).toBe(true);
  });

  it('throws on invalid config (crash fast)', () => {
    expect(() =>
      ConfigModule.forRoot({
        schema,
        serviceName: 'test-service',
        // Missing DBURL/REDISURL → base fields fill from defaults, but the
        // service-specific required fields are absent, so validation fails.
        env: {},
      }),
    ).toThrow(/Invalid configuration/);
  });
});
