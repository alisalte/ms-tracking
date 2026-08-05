import { join } from 'node:path';
/**
 * AppModule — the composition root for device-gateway-service.
 *
 * Wires the cross-cutting modules (config → logger → persistence → redis →
 * health) in dependency order, then the GatewayModule (adapters, transport,
 * session manager, dispatcher, Kafka producer, admin API). Migrations run
 * eagerly inside PersistenceModule before the listeners start.
 */
import { RedisModule } from '@fleetvision/cache-redis';
import { type BaseConfig, ConfigModule } from '@fleetvision/config';
import { HealthModule } from '@fleetvision/health';
import { LoggerModule } from '@fleetvision/observability';
import { PersistenceModule } from '@fleetvision/persistence-knex';
import { type DynamicModule, Module } from '@nestjs/common';
import { GatewayModule } from './api/gateway.module.js';
import {
  type DeviceGatewayConfig,
  deviceGatewayConfigSchema,
} from './config/device-gateway.config.js';

@Module({})
export class AppModule {
  public static forRoot(config: DeviceGatewayConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          schema: deviceGatewayConfigSchema,
          serviceName: 'device-gateway-service',
          env: process.env,
        }),
        LoggerModule.forRootFromConfig(config as BaseConfig),
        PersistenceModule.forRoot({
          client: { url: config.DBURL },
          migrations: {
            directory: join(import.meta.dirname, 'infrastructure/database/migrations'),
          },
          // Non-fatal: the gateway boots even if Postgres is down (06 §15.4).
          // Listener config is optional; the in-memory defaults apply meanwhile.
          skipMigrationsOnError: true,
        }),
        RedisModule.forRoot({ url: config.REDISURL }),
        HealthModule,
        GatewayModule.forRoot(config),
      ],
      providers: [{ provide: 'GATEWAY_CONFIG', useValue: config }],
    };
  }
}
