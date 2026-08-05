import { REDIS_TOKEN, type Redis } from '@fleetvision/cache-redis';
import { Inject, Injectable } from '@nestjs/common';
/**
 * Redis readiness indicator — pings the cache with `PING`.
 *
 * Composes into the standard terminus `HealthCheckResult` shape. Optional: a
 * service with no cache skips this indicator.
 */
import { HealthCheckError, HealthIndicator, type HealthIndicatorResult } from '@nestjs/terminus';

@Injectable()
export class RedisPingIndicator extends HealthIndicator {
  public readonly name = 'redis';

  constructor(@Inject(REDIS_TOKEN) private readonly client: Redis) {
    super();
  }

  public async isHealthy(): Promise<HealthIndicatorResult> {
    try {
      const reply = await this.client.ping();
      const ok = reply === 'PONG';
      return this.getStatus(this.name, ok, { reply });
    } catch (err) {
      const result = this.getStatus(this.name, false, { message: (err as Error).message });
      throw new HealthCheckError('Redis ping failed', result);
    }
  }
}
