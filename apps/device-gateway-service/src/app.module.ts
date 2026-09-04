import { join } from 'node:path';
/**
 * AppModule — the composition root for device-gateway-service.
 *
 * Wires the cross-cutting modules (config → logger → persistence → redis →
 * health → metrics) in dependency order, then the GatewayModule (adapters,
 * transport, session manager, dispatcher, Kafka producer, admin API).
 * Migrations run eagerly inside PersistenceModule before the listeners start.
 *
 * Sprint B: the ADMIN/CONTROL HTTP API is guarded by JWT + RBAC
 * (`telemetry.gateway.manage`). The device TCP/UDP protocol listeners are NOT
 * HTTP routes — they remain authenticated by device-protocol auth (IMEI/serial)
 * and are unaffected by the HTTP auth guard.
 *
 * Sprint D: /metrics (Prometheus) + Kafka-producer readiness (§33/§35). The
 * same GatewayModule instance is passed to HealthModule.forRoot so its exported
 * readiness indicators are injectable there (Nest instantiates it once).
 */
import { AuthModule } from '@fleetvision/auth';
import { RedisModule } from '@fleetvision/cache-redis';
import { type BaseConfig, ConfigModule } from '@fleetvision/config';
import { HealthModule } from '@fleetvision/health';
import { LoggerModule, MetricsModule } from '@fleetvision/observability';
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
    const gatewayModule = GatewayModule.forRoot(config);
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
            // Per-service ledger — the shared database's `schema_migrations`
            // table belongs to identity-service.
            tableName: 'device_gateway_schema_migrations',
          },
          // Non-fatal: the gateway boots even if Postgres is down (06 §15.4).
          // Listener config is optional; the in-memory defaults apply meanwhile.
          skipMigrationsOnError: true,
        }),
        RedisModule.forRoot({ url: config.REDISURL }),
        // Sprint B: JWT/API-key auth + global CompositeAuthGuard + PermissionsGuard.
        // Secures the admin/control HTTP API; device TCP/UDP listeners are unaffected.
        AuthModule.forRoot({
          jwt: {
            JWT_SECRET: config.JWT_SECRET,
            JWT_ISSUER: config.JWT_ISSUER,
            JWT_AUDIENCE: config.JWT_AUDIENCE,
          },
        }),
        // Sprint D §33 — Prometheus /metrics endpoint.
        MetricsModule.forRoot({
          telemetry: { prefix: 'fleetvision' },
          exposeEndpoint: config.GATEWAY_METRICS_ENABLED,
        }),
        // Sprint D §35 — readiness includes the Kafka producer (via the SAME
        // gateway module instance, whose indicators are exported).
        HealthModule.forRoot({ imports: [gatewayModule] }),
        gatewayModule,
      ],
      providers: [{ provide: 'GATEWAY_CONFIG', useValue: config }],
    };
  }
}
