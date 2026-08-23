/**
 * AppModule — composition root for media-service.
 */
import { join } from 'node:path';
import { AuthModule } from '@fleetvision/auth';
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
          // DDL (CREATE SCHEMA media …) runs as the privileged platform role
          // when provided; runtime stays on the RLS-enforced app role.
          migrationsClient: config.DBURL_PLATFORM ? { url: config.DBURL_PLATFORM } : undefined,
          migrations: {
            directory: join(import.meta.dirname, 'infrastructure/database/migrations'),
            // Per-service migration ledger (Sprint I convention) — the shared
            // dev database's default `schema_migrations` belongs to identity.
            tableName: 'media_schema_migrations',
          },
        }),
        RedisModule.forRoot({ url: config.REDISURL }),
        // Sprint B: JWT/API-key auth + global CompositeAuthGuard + PermissionsGuard.
        AuthModule.forRoot({
          jwt: {
            JWT_SECRET: config.JWT_SECRET,
            JWT_ISSUER: config.JWT_ISSUER,
            JWT_AUDIENCE: config.JWT_AUDIENCE,
          },
        }),
        HealthModule.forRoot(),
        MediaModule.forRoot(config),
      ],
    };
  }
}
