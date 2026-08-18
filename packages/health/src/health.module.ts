/**
 * HealthModule — wires terminus + the health controller. Import once in the app
 * module. Depends on the knex/redis clients being available in the DI graph
 * (via PersistenceModule / RedisModule), so its indicators can ping them.
 *
 * Sprint D §35: a service can add dependency-specific readiness probes (e.g.
 * the gateway passes a Kafka-producer indicator, gps-engine a consumer
 * indicator) by providing + exporting the `EXTRA_READINESS_INDICATORS` token
 * from one of its own modules and passing that module in `imports`:
 *
 *   const gateway = GatewayModule.forRoot(config);   // exports the token
 *   imports: [..., gateway, HealthModule.forRoot({ imports: [gateway] })]
 *
 * Liveness stays dependency-free — "alive but not ready" remains expressible.
 */
import { type DynamicModule, Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { EXTRA_READINESS_INDICATORS, type ReadinessIndicator } from './health.tokens.js';
import { KnexPingIndicator } from './knex-ping.indicator.js';
import { RedisPingIndicator } from './redis-ping.indicator.js';

export { EXTRA_READINESS_INDICATORS };
export type { ReadinessIndicator };

export interface HealthModuleOptions {
  /**
   * Modules whose exported `EXTRA_READINESS_INDICATORS` provider contributes
   * additional readiness checks. Pass the SAME dynamic-module object the app
   * already imports (Nest instantiates it once).
   */
  readonly imports?: readonly DynamicModule[];
}

@Module({})
export class HealthModule {
  /** Default form — PG + Redis readiness (backward compatible). */
  public static forRoot(options: HealthModuleOptions = {}): DynamicModule {
    return {
      module: HealthModule,
      imports: [TerminusModule.forRoot(), ...(options.imports ?? [])],
      controllers: [HealthController],
      providers: [KnexPingIndicator, RedisPingIndicator],
    };
  }
}
