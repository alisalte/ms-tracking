import {
  AuthCoreModule,
  TOKEN_VERIFIER,
  type TokenVerifier,
  jwtAuthGuardProvider,
} from '@fleetvision/auth';
/**
 * GpsEngineModule — wires the GPS engine components (07 §1.5).
 *
 * Composes the cross-cutting packages (already imported by AppModule) with the
 * engine core: Kafka consumer, position + device-status pipelines, TimescaleDB
 * repos, Redis caches, the signal bus, the WebSocket broadcaster, and the REST
 * API. Mirrors the identity-service / device-gateway factory-`forRoot` style.
 *
 * On bootstrap it: starts the Kafka consumer (non-fatal), starts the WS server
 * (non-fatal). Kafka/Redis/Postgres down does NOT stop the service from booting.
 */
import { REDIS_TOKEN } from '@fleetvision/cache-redis';
import type { Redis } from '@fleetvision/cache-redis';
import { KNEX_TOKEN } from '@fleetvision/persistence-knex';
import { type DynamicModule, Module } from '@nestjs/common';
import { DeviceStatusPipeline } from '../application/device-status-pipeline.js';
import { PositionPipeline } from '../application/position-pipeline.js';
import { SignalBus } from '../application/signal-bus.js';
import { TripEngine } from '../application/trip-engine.js';
import type { GpsEngineConfig } from '../config/gps-engine.config.js';
import { RedisDeviceStatusCache } from '../infrastructure/cache/redis-device-status-cache.js';
import { RedisFsmCache } from '../infrastructure/cache/redis-fsm-cache.js';
import { RedisPositionCache } from '../infrastructure/cache/redis-position-cache.js';
import { GpsEngineKafkaConsumer } from '../infrastructure/kafka/kafka-consumer.js';
import { DeviceStatusRepository } from '../infrastructure/persistence/device-status.repository.js';
import { PositionRepository } from '../infrastructure/persistence/position.repository.js';
import { TripRepository } from '../infrastructure/persistence/trip.repository.js';
import { RealtimeGateway } from '../infrastructure/websocket/realtime.gateway.js';
import { DeviceStatusController } from './device-status.controller.js';
import { PositionsController } from './positions.controller.js';
import {
  DEVICE_STATUS_CACHE,
  DEVICE_STATUS_PIPELINE,
  DEVICE_STATUS_REPOSITORY,
  FSM_CACHE,
  GPS_ENGINE_CONFIG,
  KAFKA_CONSUMER,
  POSITION_CACHE,
  POSITION_PIPELINE,
  POSITION_REPOSITORY,
  REALTIME_GATEWAY,
  SIGNAL_BUS,
  TRIP_ENGINE,
  TRIP_REPOSITORY,
} from './tokens.js';

@Module({})
export class GpsEngineModule {
  public static forRoot(config: GpsEngineConfig): DynamicModule {
    return {
      module: GpsEngineModule,
      imports: [
        // Verifies identity-issued HS256 JWTs and binds the SharedJwtVerifier to
        // the TokenVerifier port; jwtAuthGuardProvider() builds the JwtAuthGuard
        // the controllers apply via @UseGuards.
        AuthCoreModule.forRoot({
          jwtSecret: config.JWT_SECRET,
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
        }),
      ],
      providers: [
        jwtAuthGuardProvider(),
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
        // Trip engine (Sprint 8).
        {
          provide: TRIP_ENGINE,
          inject: [GPS_ENGINE_CONFIG, FSM_CACHE, POSITION_CACHE, TRIP_REPOSITORY, SIGNAL_BUS],
          useFactory: (
            cfg: GpsEngineConfig,
            fsmCache: RedisFsmCache,
            positionCache: RedisPositionCache,
            tripRepo: TripRepository,
            signalBus: SignalBus,
          ) =>
            new TripEngine({
              config: cfg,
              fsmCache,
              positionCache,
              tripRepo,
              signalBus,
            }),
        },
        // Pipelines.
        {
          provide: POSITION_PIPELINE,
          inject: [GPS_ENGINE_CONFIG, POSITION_REPOSITORY, POSITION_CACHE, SIGNAL_BUS, TRIP_ENGINE],
          useFactory: (
            cfg: GpsEngineConfig,
            positions: PositionRepository,
            cache: RedisPositionCache,
            signalBus: SignalBus,
            tripEngine: TripEngine,
          ) => new PositionPipeline({ config: cfg, positions, cache, signalBus, tripEngine }),
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
        // Kafka consumer (non-fatal at boot).
        {
          provide: KAFKA_CONSUMER,
          inject: [GPS_ENGINE_CONFIG, POSITION_PIPELINE, DEVICE_STATUS_PIPELINE],
          useFactory: (
            cfg: GpsEngineConfig,
            posPipeline: PositionPipeline,
            devPipeline: DeviceStatusPipeline,
          ) =>
            new GpsEngineKafkaConsumer({
              config: cfg,
              positionPipeline: posPipeline,
              deviceStatusPipeline: devPipeline,
            }),
        },
        // WebSocket broadcaster.
        {
          provide: REALTIME_GATEWAY,
          inject: [GPS_ENGINE_CONFIG, REDIS_TOKEN, SIGNAL_BUS, TOKEN_VERIFIER],
          useFactory: (
            cfg: GpsEngineConfig,
            redis: Redis,
            signalBus: SignalBus,
            tokenVerifier: TokenVerifier,
          ) => new RealtimeGateway({ config: cfg, redis, signalBus, tokenVerifier }),
        },
        PositionsController,
        DeviceStatusController,
      ],
      controllers: [PositionsController, DeviceStatusController],
    };
  }
}
