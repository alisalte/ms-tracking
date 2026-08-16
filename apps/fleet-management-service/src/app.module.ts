import { join } from 'node:path';
/**
 * AppModule — the composition root for fleet-management-service.
 *
 * Wires the cross-cutting modules (config → logger → persistence → redis →
 * auth → health) in dependency order, then the FleetManagementModule (fleet/
 * vehicle/device domain, REST API, audit, Kafka session-lifecycle consumer).
 * Migrations run eagerly inside PersistenceModule before the HTTP server starts.
 *
 * Sprint B security boundary: the CompositeAuthGuard + PermissionsGuard (registered
 * globally by AuthModule) enforce JWT/API-key authn and `@RequirePermissions` authz
 * on every HTTP route. The tenant is taken from the verified credential
 * (INV-I02) — never a client header. The device-gateway reaches the resolve
 * endpoint with a service API key (`device.registry.resolve`).
 */
import { AuthModule } from '@fleetvision/auth';
import { RedisModule } from '@fleetvision/cache-redis';
import { type BaseConfig, ConfigModule } from '@fleetvision/config';
import { HealthModule } from '@fleetvision/health';
import { LoggerModule } from '@fleetvision/observability';
import { PersistenceModule } from '@fleetvision/persistence-knex';
import { type DynamicModule, Module } from '@nestjs/common';
import { FleetManagementModule } from './api/fleet-management.module.js';
import {
  type FleetManagementConfig,
  fleetManagementConfigSchema,
} from './config/fleet-management.config.js';

@Module({})
export class AppModule {
  public static forRoot(config: FleetManagementConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          schema: fleetManagementConfigSchema,
          serviceName: 'fleet-management-service',
          env: process.env,
        }),
        LoggerModule.forRootFromConfig(config as BaseConfig),
        PersistenceModule.forRoot({
          client: { url: config.DBURL },
          migrations: {
            directory: join(import.meta.dirname, 'infrastructure/database/migrations'),
            // Per-service migration ledger (Sprint I convention — see
            // map-engine/notification): the shared dev database's default
            // `schema_migrations` table belongs to identity-service.
            tableName: 'fleet_management_schema_migrations',
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
        FleetManagementModule.forRoot(config),
      ],
      providers: [{ provide: 'FLEET_MANAGEMENT_CONFIG', useValue: config }],
    };
  }
}
