import type { Knex } from '@fleetvision/persistence-knex';
import { KNEX_TOKEN } from '@fleetvision/persistence-knex';
import { Inject, Injectable, Optional } from '@nestjs/common';
/**
 * Knex readiness indicator — pings Postgres by selecting 1.
 *
 * Wraps @nestjs/terminus `HealthIndicator` so the result composes into the
 * standard terminus `HealthCheckResult` shape (`{ status, info, error, details }`).
 * The knex client is injected @Optional so the health module works even in
 * services that have no DB (the indicator reports a skipped/healthy result
 * instead of crashing the DI graph).
 */
import { HealthCheckError, HealthIndicator, type HealthIndicatorResult } from '@nestjs/terminus';

@Injectable()
export class KnexPingIndicator extends HealthIndicator {
  constructor(@Optional() @Inject(KNEX_TOKEN) private readonly client: Knex | null) {
    super();
  }

  /** Key under which the result appears in the readiness `details`. */
  public readonly name = 'postgres';

  public async isHealthy(): Promise<HealthIndicatorResult> {
    // No knex client bound — this service has no DB; report healthy+skipped.
    if (!this.client) {
      return this.getStatus(this.name, true, { skipped: 'no knex client bound' });
    }
    try {
      await this.client.raw('SELECT 1');
      return this.getStatus(this.name, true);
    } catch (err) {
      const result = this.getStatus(this.name, false, { message: (err as Error).message });
      throw new HealthCheckError('Postgres ping failed', result);
    }
  }
}
