import { describe, expect, it } from '@jest/globals';
import { identityConfigSchema } from '../config/identity.config.js';

/**
 * Pins the crash-fast contract: a valid env parses to a typed config, and a
 * missing required var throws before the server starts. Sprint 2 extends the
 * schema with JWT/argon2/lockout/Kafka params — this test covers the new gates.
 */
describe('identityConfigSchema', () => {
  const validEnv = {
    serviceName: 'identity-service',
    PORT: '3000',
    HOST: '0.0.0.0',
    LOG_LEVEL: 'info',
    ENVIRONMENT: 'local',
    DBURL: 'postgres://fleetvision:pw@localhost:5432/fleetvision',
    REDISURL: 'redis://localhost:6379/0',
    JWT_SECRET: 'a'.repeat(48),
  };

  it('parses a valid environment into typed config', () => {
    const cfg = identityConfigSchema.parse(validEnv);
    expect(cfg.PORT).toBe(3000);
    expect(cfg.DBURL).toContain('postgres://');
    expect(cfg.REDISURL).toContain('redis://');
    expect(cfg.JWT_ISSUER).toBe('fleetvision');
    expect(cfg.JWT_AUDIENCE).toBe('fleetvision');
  });

  it('applies JWT/argon2/lockout defaults when omitted', () => {
    const cfg = identityConfigSchema.parse(validEnv);
    expect(cfg.JWT_ACCESS_TTL).toBe('900s');
    expect(cfg.JWT_REFRESH_TTL).toBe('604800s');
    expect(cfg.ARGON2_MEMORY_KIB).toBe(65536);
    expect(cfg.ARGON2_TIME).toBe(3);
    expect(cfg.ARGON2_PARALLELISM).toBe(1);
    expect(cfg.PASSWORD_MIN_LENGTH).toBe(12);
    expect(cfg.PASSWORD_HISTORY_COUNT).toBe(5);
    expect(cfg.LOGIN_MAX_ATTEMPTS).toBe(5);
    expect(cfg.LOGIN_LOCKOUT_SECONDS).toBe(900);
    expect(cfg.KAFKA_BROKERS).toBe('localhost:9092');
  });

  it('throws when DBURL is missing (crash-fast)', () => {
    const { DBURL: _omit, ...withoutDb } = validEnv;
    void _omit;
    expect(() => identityConfigSchema.parse(withoutDb)).toThrow();
  });

  it('throws when JWT_SECRET is missing (crash-fast)', () => {
    const { JWT_SECRET: _omit, ...withoutSecret } = validEnv;
    void _omit;
    expect(() => identityConfigSchema.parse(withoutSecret)).toThrow();
  });

  it('rejects a JWT_SECRET shorter than 32 chars', () => {
    expect(() => identityConfigSchema.parse({ ...validEnv, JWT_SECRET: 'too-short' })).toThrow();
  });

  it('rejects an out-of-range port', () => {
    expect(() => identityConfigSchema.parse({ ...validEnv, PORT: '99999' })).toThrow();
  });

  it('coerces numeric env strings to numbers', () => {
    const cfg = identityConfigSchema.parse({
      ...validEnv,
      ARGON2_TIME: '5',
      LOGIN_MAX_ATTEMPTS: '3',
    });
    expect(cfg.ARGON2_TIME).toBe(5);
    expect(cfg.LOGIN_MAX_ATTEMPTS).toBe(3);
  });
});
