/**
 * AppModule — the composition root for identity-service.
 *
 * Wires the cross-cutting modules (config → logger → persistence → redis →
 * health) in dependency order, then the Sprint 2 AuthModule (auth, users,
 * tenants, api-keys) and the Kafka outbox relay. Migrations run eagerly inside
 * PersistenceModule before the HTTP server starts.
 */
import { join } from 'node:path';
import { RedisModule } from '@fleetvision/cache-redis';
import { type BaseConfig, ConfigModule } from '@fleetvision/config';
import { HealthModule } from '@fleetvision/health';
import { LoggerModule } from '@fleetvision/observability';
import { PersistenceModule } from '@fleetvision/persistence-knex';
import { type DynamicModule, Module } from '@nestjs/common';
import { AuthModule } from './api/auth/auth.module.js';
import { type IdentityConfig, identityConfigSchema } from './config/identity.config.js';

@Module({})
export class AppModule {
  public static forRoot(config: IdentityConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          schema: identityConfigSchema,
          serviceName: 'identity-service',
          env: process.env,
        }),
        LoggerModule.forRootFromConfig(config as BaseConfig),
        PersistenceModule.forRoot({
          // Runtime client: connects as fleetvision_app (RLS-enforced).
          client: { url: config.DBURL },
          // Migrations + platform ops: connects as fleetvision_platform (BYPASSRLS)
          // or the bootstrap superuser. Falls back to DBURL in dev.
          migrationsClient: config.DBURL_PLATFORM ? { url: config.DBURL_PLATFORM } : undefined,
          platformClient: config.DBURL_PLATFORM ? { url: config.DBURL_PLATFORM } : undefined,
          migrations: {
            directory: join(import.meta.dirname, 'infrastructure/database/migrations'),
          },
        }),
        RedisModule.forRoot({ url: config.REDISURL }),
        HealthModule,
        AuthModule.forRoot(config),
      ],
      providers: [{ provide: 'IDENTITY_CONFIG', useValue: config }],
    };
  }
}
