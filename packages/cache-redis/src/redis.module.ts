/**
 * RedisModule — provides the ioredis client as a global injectable and closes it
 * on shutdown (DoD #7: SIGTERM closes Redis without hanging).
 *
 * Usage:
 *   RedisModule.forRoot({ url: cfg.redisUrl })
 */
import {
  type DynamicModule,
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Redis } from './redis.factory.js';
import { type RedisFactoryOptions, createRedisClient } from './redis.factory.js';

export const REDIS_TOKEN = 'FLEETVISION_REDIS';

export interface RedisModuleOptions extends RedisFactoryOptions {}

@Global()
@Module({})
export class RedisModule implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisModule.name);

  public static forRoot(options: RedisModuleOptions): DynamicModule {
    const client = createRedisClient(options);
    const clientProvider = { provide: REDIS_TOKEN, useValue: client };

    return {
      module: RedisModule,
      global: true,
      providers: [clientProvider],
      exports: [REDIS_TOKEN],
    };
  }

  constructor(@Inject(REDIS_TOKEN) private readonly client: Redis) {}

  public async onApplicationShutdown(): Promise<void> {
    this.logger.log('Closing Redis client (graceful shutdown).');
    await this.client.quit();
  }
}
