/**
 * GpsEngineModule — wires the GPS engine components (07 §1.5).
 *
 * Composes the cross-cutting packages (already imported by AppModule) with the
 * engine core: Kafka consumer (+ DLQ producer), position + device-status
 * pipelines, TimescaleDB repos, Redis caches, the signal bus, the WebSocket
 * broadcaster, the device-stale sweeper, and the REST API. Mirrors the
 * identity-service / device-gateway factory-`forRoot` style.
 *
 * On bootstrap it: starts the Kafka consumer (non-fatal, retried with backoff),
 * starts the WS server (non-fatal), starts the ONLINE→STALE sweeper. Kafka /
 * Redis / Postgres down does NOT stop the service from booting.
 *
 * Sprint D: DLQ producer + metrics wired through every pipeline; the module
 * exports the consumer + readiness indicators for /health/ready (§35).
 */
import { REDIS_TOKEN } from '@fleetvision/cache-redis';
import type { Redis } from '@fleetvision/cache-redis';
import { EXTRA_READINESS_INDICATORS, type ReadinessIndicator } from '@fleetvision/health';
import { METRICS_TOKEN, type TelemetryMetrics } from '@fleetvision/observability';
import { KNEX_TOKEN } from '@fleetvision/persistence-knex';
import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DeviceStatusPipeline } from '../application/device-status-pipeline.js';
import { PositionPipeline } from '../application/position-pipeline.js';
import { SignalBus } from '../application/signal-bus.js';
import { TripEngine } from '../application/trip-engine.js';
import type { GpsEngineConfig } from '../config/gps-engine.config.js';
import { RedisDeviceStatusCache } from '../infrastructure/cache/redis-device-status-cache.js';
import { RedisFsmCache } from '../infrastructure/cache/redis-fsm-cache.js';
import { RedisPositionCache } from '../infrastructure/cache/redis-position-cache.js';
import { DlqProducer } from '../infrastructure/kafka/dlq-producer.js';
import { GpsEngineKafkaConsumer } from '../infrastructure/kafka/kafka-consumer.js';
import { DeviceStatusRepository } from '../infrastructure/persistence/device-status.repository.js';
import { PositionRepository } from '../infrastructure/persistence/position.repository.js';
import { TripRepository } from '../infrastructure/persistence/trip.repository.js';
import { DeviceStaleSweeper } from '../infrastructure/scheduling/device-stale-sweeper.js';
import { RealtimeGateway } from '../infrastructure/websocket/realtime.gateway.js';
import { AdminController } from './admin.controller.js';
import { DeviceStatusController } from './device-status.controller.js';
import { PositionsController } from './positions.controller.js';
import {
  DEVICE_STATUS_CACHE,
  DEVICE_STATUS_PIPELINE,
  DEVICE_STATUS_REPOSITORY,
  DLQ_PRODUCER,
  FSM_CACHE,
  GPS_ENGINE_CONFIG,
  KAFKA_CONSUMER,
  POSITION_CACHE,
  POSITION_PIPELINE,
  POSITION_REPOSITORY,
  REALTIME_GATEWAY,
  SIGNAL_BUS,
  STALE_SWEEPER,
  TRIP_ENGINE,
  TRIP_REPOSITORY,
} from './tokens.js';
import { TripsController } from './trips.controller.js';

@Module({})
export class GpsEngineModule {
  public static forRoot(config: GpsEngineConfig): DynamicModule {
    const readinessProvider: Provider = {
      provide: EXTRA_READINESS_INDICATORS,
      inject: [KAFKA_CONSUMER],
      useFactory: (consumer: GpsEngineKafkaConsumer): readonly ReadinessIndicator[] => [
        async () => ({
          kafka_consumer: {
            status: consumer.isRunning ? 'up' : 'down',
          },
        }),
      ],
    };

    return {
      module: GpsEngineModule,
      providers: [
        { provide: GPS_ENGINE_CONFIG, useValue: config },
        { provide: SIGNAL_BUS, useClass: SignalBus },
        // Repositories (take the global knex client).
        {
          provide: POSITION_REPOSITORY,
          inject: [KNEX_TOKEN],
          useFactory: (knex: unknown) => new PositionRepository(knex as never),
        },
        {
          provide: DEVICE_STATUS_REPOSITORY,
          inject: [KNEX_TOKEN],
          useFactory: (knex: unknown) => new DeviceStatusRepository(knex as never),
        },
        {
          provide: TRIP_REPOSITORY,
          inject: [KNEX_TOKEN],
          useFactory: (knex: unknown) => new TripRepository(knex as never),
        },
        // Redis caches.
        {
          provide: POSITION_CACHE,
          inject: [REDIS_TOKEN],
          useFactory: (redis: Redis) =>
            new RedisPositionCache(redis, config.GPS_REPORT_INTERVAL_SECONDS),
        },
        {
          provide: DEVICE_STATUS_CACHE,
          inject: [REDIS_TOKEN],
          useFactory: (redis: Redis) => new RedisDeviceStatusCache(redis),
        },
        {
          provide: FSM_CACHE,
          inject: [REDIS_TOKEN],
          useFactory: (redis: Redis) => new RedisFsmCache(redis),
        },
        // Trip engine (Sprint 8; Sprint D metrics).
        {
          provide: TRIP_ENGINE,
          inject: [
            GPS_ENGINE_CONFIG,
            FSM_CACHE,
            POSITION_CACHE,
            TRIP_REPOSITORY,
            SIGNAL_BUS,
            METRICS_TOKEN,
          ],
          useFactory: (
            cfg: GpsEngineConfig,
            fsmCache: RedisFsmCache,
            positionCache: RedisPositionCache,
            tripRepo: TripRepository,
            signalBus: SignalBus,
            metrics: TelemetryMetrics,
          ) =>
            new TripEngine({
              config: cfg,
              fsmCache,
              positionCache,
              tripRepo,
              signalBus,
              metrics,
            }),
        },
        // Pipelines (Sprint D: device-status repo + metrics wired in).
        {
          provide: POSITION_PIPELINE,
          inject: [
            GPS_ENGINE_CONFIG,
            POSITION_REPOSITORY,
            POSITION_CACHE,
            SIGNAL_BUS,
            TRIP_ENGINE,
            DEVICE_STATUS_REPOSITORY,
            METRICS_TOKEN,
          ],
          useFactory: (
            cfg: GpsEngineConfig,
            positions: PositionRepository,
            cache: RedisPositionCache,
            signalBus: SignalBus,
            tripEngine: TripEngine,
            deviceStatus: DeviceStatusRepository,
            metrics: TelemetryMetrics,
          ) =>
            new PositionPipeline({
              config: cfg,
              positions,
              cache,
              signalBus,
              tripEngine,
              deviceStatus,
              metrics,
            }),
        },
        {
          provide: DEVICE_STATUS_PIPELINE,
          inject: [DEVICE_STATUS_REPOSITORY, DEVICE_STATUS_CACHE, SIGNAL_BUS],
          useFactory: (
            statusRepo: DeviceStatusRepository,
            statusCache: RedisDeviceStatusCache,
            signalBus: SignalBus,
          ) => new DeviceStatusPipeline({ statusRepo, statusCache, signalBus }),
        },
        // Sprint D §15 — DLQ producer (non-fatal at boot, lazy connect).
        {
          provide: DLQ_PRODUCER,
          inject: [GPS_ENGINE_CONFIG, METRICS_TOKEN],
          useFactory: (cfg: GpsEngineConfig, metrics: TelemetryMetrics) =>
            new DlqProducer({
              brokers: cfg.GPS_KAFKA_BROKERS.split(','),
              clientId: `${cfg.GPS_KAFKA_CLIENT_ID}-dlq`,
              groupId: cfg.GPS_KAFKA_GROUP_ID,
              metrics,
            }),
        },
        // Kafka consumer (non-fatal at boot; Sprint D retry + DLQ + metrics).
        {
          provide: KAFKA_CONSUMER,
          inject: [
            GPS_ENGINE_CONFIG,
            POSITION_PIPELINE,
            DEVICE_STATUS_PIPELINE,
            DLQ_PRODUCER,
            METRICS_TOKEN,
          ],
          useFactory: (
            cfg: GpsEngineConfig,
            posPipeline: PositionPipeline,
            devPipeline: DeviceStatusPipeline,
            dlq: DlqProducer,
            metrics: TelemetryMetrics,
          ) =>
            new GpsEngineKafkaConsumer({
              config: cfg,
              positionPipeline: posPipeline,
              deviceStatusPipeline: devPipeline,
              dlq,
              metrics,
            }),
        },
        // Sprint D §10 — ONLINE→STALE sweeper (covers crashed-gateway devices).
        {
          provide: STALE_SWEEPER,
          inject: [GPS_ENGINE_CONFIG, DEVICE_STATUS_REPOSITORY, SIGNAL_BUS],
          useFactory: (
            cfg: GpsEngineConfig,
            statusRepo: DeviceStatusRepository,
            signalBus: SignalBus,
          ) => new DeviceStaleSweeper(cfg, statusRepo, signalBus),
        },
        // WebSocket broadcaster (Sprint D coalescing + metrics).
        {
          provide: REALTIME_GATEWAY,
          inject: [GPS_ENGINE_CONFIG, REDIS_TOKEN, SIGNAL_BUS, JwtService, METRICS_TOKEN],
          useFactory: (
            cfg: GpsEngineConfig,
            redis: Redis,
            signalBus: SignalBus,
            jwt: JwtService,
            metrics: TelemetryMetrics,
          ) =>
            new RealtimeGateway({
              config: cfg,
              redis,
              signalBus,
              jwt,
              issuer: cfg.JWT_ISSUER,
              audience: cfg.JWT_AUDIENCE,
              metrics,
            }),
        },
        // Sprint D §35 — consumer readiness (liveness never checks Kafka).
        readinessProvider,
        PositionsController,
        TripsController,
        DeviceStatusController,
        AdminController,
      ],
      controllers: [PositionsController, TripsController, DeviceStatusController, AdminController],
      exports: [KAFKA_CONSUMER, EXTRA_READINESS_INDICATORS],
    };
  }
}
