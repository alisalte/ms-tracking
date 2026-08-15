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
          client: { url: config.DBURL },
          migrations: {
            directory: join(import.meta.dirname, 'infrastructure/database/migrations'),
          },
        }),
        RedisModule.forRoot({ url: config.REDISURL }),
        HealthModule.forRoot(),
        AuthModule.forRoot(config),
      ],
      providers: [{ provide: 'IDENTITY_CONFIG', useValue: config }],
    };
  }
}
