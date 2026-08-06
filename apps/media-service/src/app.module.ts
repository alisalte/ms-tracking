/**
 * AppModule — composition root for media-service.
 */
import { join } from 'node:path';
import { RedisModule } from '@fleetvision/cache-redis';
import { type BaseConfig, ConfigModule } from '@fleetvision/config';
import { HealthModule } from '@fleetvision/health';
import { LoggerModule } from '@fleetvision/observability';
import { PersistenceModule } from '@fleetvision/persistence-knex';
import { type DynamicModule, Module } from '@nestjs/common';
import { MediaModule } from './api/media.module.js';
import { type MediaConfig, mediaConfigSchema } from './config/media.config.js';

@Module({})
export class AppModule {
  public static forRoot(config: MediaConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          schema: mediaConfigSchema,
          serviceName: 'media-service',
          env: process.env,
        }),
        LoggerModule.forRootFromConfig(config as BaseConfig),
        PersistenceModule.forRoot({
          client: { url: config.DBURL },
          migrations: {
            directory: join(import.meta.dirname, 'infrastructure/database/migrations'),
          },
        }),
        RedisModule.forRoot({ url: config.REDISURL }),
        HealthModule,
        MediaModule.forRoot(config),
      ],
    };
  }
}
