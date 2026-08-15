import { Public } from '@fleetvision/web';
/**
 * Health controller — the two smoke-test endpoints (01 §10.1, Sprint 1 DoD #5).
 *
 *  - `GET /health/live`  — liveness. Always 200 while the process is alive.
 *  - `GET /health/ready` — readiness. 200 only when PG (knex) AND Redis ping
 *    (plus any service-provided extra indicators — Sprint D §35, e.g. Kafka).
 *
 * Liveness deliberately runs NO dependencies so a slow DB cannot kill the pod;
 * Kubernetes restarts it only if the process itself is wedged. Readiness gates
 * traffic: the load balancer stops sending requests until deps recover.
 */
import { Controller, Get, Inject, Optional } from '@nestjs/common';
// biome-ignore lint/style/useImportType: HealthCheckService is a NestJS DI injectable (value), used via emitDecoratorMetadata.
import { HealthCheck, type HealthCheckResult, HealthCheckService } from '@nestjs/terminus';
import { EXTRA_READINESS_INDICATORS, type ReadinessIndicator } from './health.tokens.js';
// biome-ignore lint/style/useImportType: value import required — NestJS DI reads constructor param types via emitDecoratorMetadata; a type-only import erases the class and degrades the reflected type to Function, breaking injection.
import { KnexPingIndicator } from './knex-ping.indicator.js';
// biome-ignore lint/style/useImportType: value import required for NestJS DI metadata (see above).
import { RedisPingIndicator } from './redis-ping.indicator.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly knexPing: KnexPingIndicator,
    private readonly redisPing: RedisPingIndicator,
    @Inject(EXTRA_READINESS_INDICATORS)
    @Optional()
    private readonly extraIndicators: readonly ReadinessIndicator[] = [],
  ) {}

  /** Liveness — the process is up. No dependency checks (never fails on a slow dep). */
  @Get('live')
  @HealthCheck()
  public async live(): Promise<HealthCheckResult> {
    // No indicators: terminus returns an empty-but-healthy result.
    return this.health.check([]);
  }

  /** Readiness — dependencies (Postgres, Redis, + service extras) must respond. */
  @Get('ready')
  @HealthCheck()
  public async ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.knexPing.isHealthy(),
      () => this.redisPing.isHealthy(),
      ...this.extraIndicators.map((indicator) => () => indicator()),
    ]);
  }
}
