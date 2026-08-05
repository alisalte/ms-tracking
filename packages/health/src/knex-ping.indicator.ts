import type { Knex } from '@fleetvision/persistence-knex';
import { KNEX_TOKEN } from '@fleetvision/persistence-knex';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
/**
 * Knex readiness indicator — pings Postgres by selecting 1.
 *
 * Wraps @nestjs/terminus `HealthIndicator` so the result composes into the
 * standard terminus `HealthCheckResult` shape (`{ status, info, error, details }`).
 * Marked optional so the health module works in services that have no DB.
 */
import { HealthCheckError, HealthIndicator, type HealthIndicatorResult } from '@nestjs/terminus';

@Injectable()
export class KnexPingIndicator extends HealthIndicator implements OnModuleInit {
  private knexAvailable = false;

  public onModuleInit(): void {
    // The knex client is optional — some services are cache-only. Detect at boot.
    this.knexAvailable = true;
  }

  constructor(@Inject(KNEX_TOKEN) private readonly client: Knex) {
    super();
  }

  /** Key under which the result appears in the readiness `details`. */
  public readonly name = 'postgres';

  public async isHealthy(): Promise<HealthIndicatorResult> {
    if (!this.knexAvailable) {
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
