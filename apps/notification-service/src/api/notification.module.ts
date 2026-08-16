/**
 * NotificationModule — wires the Alarm Engine + Notification delivery tier:
 * Kafka consumer, evaluator, dispatcher, repositories, WS gateway, REST controllers.
 */
import {
  AuthModule,
  SharedJwtVerifier,
  TOKEN_VERIFIER,
  type TokenVerifier,
} from '@fleetvision/auth';
import { REDIS_TOKEN } from '@fleetvision/cache-redis';
import type { Redis } from '@fleetvision/cache-redis';
import { METRICS_TOKEN } from '@fleetvision/observability';
import type { TelemetryMetrics } from '@fleetvision/observability';
import { KNEX_TOKEN, PLATFORM_KNEX_TOKEN } from '@fleetvision/persistence-knex';
import type { Knex } from '@fleetvision/persistence-knex';
import { type DynamicModule, Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AlarmEvaluatorService } from '../application/alarm-evaluator.service.js';
import {
  InAppChannel,
  PushChannel,
  SmsChannel,
  SmtpEmailProvider,
  WebSocketChannel,
} from '../application/channels/channels.js';
import { NotificationProviderRegistry } from '../application/channels/provider-registry.js';
import { DeliveryExecutor } from '../application/delivery-executor.js';
import { DeliveryRetryWorker } from '../application/delivery-retry-worker.js';
import { NotificationDispatcherService } from '../application/notification-dispatcher.service.js';
import type { NotificationConfig } from '../config/notification.config.js';
import { AlarmStateCache } from '../infrastructure/cache/alarm-state-cache.js';
import { NotificationRateLimiter } from '../infrastructure/cache/notification-rate-limiter.js';
import { AlarmDlqProducer } from '../infrastructure/kafka/alarm-dlq-producer.js';
import { AlarmKafkaConsumer } from '../infrastructure/kafka/alarm-kafka-consumer.js';
import { AlarmOccurrenceRepository } from '../infrastructure/persistence/alarm-occurrence.repository.js';
import { AlarmRuleRepository } from '../infrastructure/persistence/alarm-rule.repository.js';
import { FleetEventRepository } from '../infrastructure/persistence/fleet-event.repository.js';
import { NotificationDeliveryRepository } from '../infrastructure/persistence/notification-delivery.repository.js';
import { NotificationPreferenceRepository } from '../infrastructure/persistence/notification-preference.repository.js';
import { NotificationRepository } from '../infrastructure/persistence/notification.repository.js';
import { UserDirectory } from '../infrastructure/persistence/user-directory.js';
import { AlarmRealtimeGateway } from '../infrastructure/websocket/alarm-realtime.gateway.js';
import { AlarmsController } from './alarms.controller.js';
import { EventsController } from './events.controller.js';
import { ALARM_REALTIME_GATEWAY, NOTIFICATION_PROVIDER_REGISTRY } from './notification.tokens.js';
import { NotificationsController } from './notifications.controller.js';
import { RulesController } from './rules.controller.js';

export const NOTIF_CONFIG = 'NOTIF_CONFIG';
export const ALARM_KAFKA_CONSUMER = 'ALARM_KAFKA_CONSUMER';
export { ALARM_REALTIME_GATEWAY, NOTIFICATION_PROVIDER_REGISTRY };

@Module({})
export class NotificationModule {
  public static forRoot(config: NotificationConfig): DynamicModule {
    // SMTP config (null when unset → email channel disabled).
    const smtpConfig = config.NOTIF_SMTP_HOST
      ? {
          host: config.NOTIF_SMTP_HOST,
          port: config.NOTIF_SMTP_PORT ?? 587,
          user: config.NOTIF_SMTP_USER ?? '',
          pass: config.NOTIF_SMTP_PASS ?? '',
          from: config.NOTIF_SMTP_FROM ?? 'no-reply@fleetvision.local',
        }
      : null;

    return {
      module: NotificationModule,
      imports: [
        AuthModule.forRoot({
          jwt: {
            JWT_SECRET: config.JWT_SECRET,
            JWT_ISSUER: config.JWT_ISSUER,
            JWT_AUDIENCE: config.JWT_AUDIENCE,
          },
        }),
      ],
      providers: [
        // TOKEN_VERIFIER — the read-only peer that verifies identity-issued
        // JWTs with the shared HS256 secret (used by the WS gateway handshake;
        // HTTP auth is enforced globally by AuthModule's CompositeAuthGuard +
        // PermissionsGuard via APP_GUARD — @RequirePermissions per route).
        {
          provide: TOKEN_VERIFIER,
          inject: [JwtService],
          useFactory: (jwt: JwtService) =>
            new SharedJwtVerifier(jwt, {
              issuer: config.JWT_ISSUER,
              audience: config.JWT_AUDIENCE,
            }),
        },
        { provide: NOTIF_CONFIG, useValue: config },
        // Alarm repositories. Sprint G: rule repo gets the Redis rule cache
        // (short TTL, invalidated on every mutation — Part 38).
        {
          provide: AlarmRuleRepository,
          inject: [KNEX_TOKEN, REDIS_TOKEN, NOTIF_CONFIG],
          useFactory: (knex: Knex, redis: Redis, cfg: NotificationConfig) =>
            new AlarmRuleRepository(knex, redis, cfg.NOTIF_RULE_CACHE_TTL_SECONDS),
        },
        {
          provide: AlarmOccurrenceRepository,
          inject: [KNEX_TOKEN],
          useFactory: (knex: Knex) => new AlarmOccurrenceRepository(knex),
        },
        // Sprint I — GeofenceQuery removed: geofence detection moved to the
        // gps-engine evaluator; alarm rules consume geofence.* FleetEvents.
        // Sprint G Part 35 — FleetEvent history persistence.
        {
          provide: FleetEventRepository,
          inject: [KNEX_TOKEN],
          useFactory: (knex: Knex) => new FleetEventRepository(knex),
        },
        // Notification repositories.
        {
          provide: NotificationRepository,
          inject: [KNEX_TOKEN],
          useFactory: (knex: Knex) => new NotificationRepository(knex),
        },
        {
          provide: NotificationPreferenceRepository,
          inject: [KNEX_TOKEN, PLATFORM_KNEX_TOKEN],
          useFactory: (knex: Knex, platformKnex: Knex) =>
            new NotificationPreferenceRepository(knex, platformKnex),
        },
        {
          provide: NotificationDeliveryRepository,
          inject: [KNEX_TOKEN, PLATFORM_KNEX_TOKEN],
          useFactory: (knex: Knex, platformKnex: Knex) =>
            new NotificationDeliveryRepository(knex, platformKnex),
        },
        // Sprint H — trusted recipient directory (read-only iam.users).
        {
          provide: UserDirectory,
          inject: [PLATFORM_KNEX_TOKEN, REDIS_TOKEN],
          useFactory: (platformKnex: Knex, redis: Redis) => new UserDirectory(platformKnex, redis),
        },
        // Redis state cache.
        {
          provide: AlarmStateCache,
          inject: [REDIS_TOKEN],
          useFactory: (redis: Redis) => new AlarmStateCache(redis),
        },
        // WS gateway.
        {
          provide: ALARM_REALTIME_GATEWAY,
          inject: [NOTIF_CONFIG, REDIS_TOKEN, TOKEN_VERIFIER],
          useFactory: (cfg: NotificationConfig, redis: Redis, tv: TokenVerifier) =>
            new AlarmRealtimeGateway({ config: cfg, redis, tokenVerifier: tv }),
        },
        // Sprint H — provider registry: configuration-driven channel →
        // provider mapping (no "if email then SMTP" in business logic).
        {
          provide: NOTIFICATION_PROVIDER_REGISTRY,
          inject: [NOTIF_CONFIG, ALARM_REALTIME_GATEWAY, PLATFORM_KNEX_TOKEN],
          useFactory: (
            cfg: NotificationConfig,
            gateway: AlarmRealtimeGateway,
            platformKnex: Knex,
          ) => {
            const userDirectory = new UserDirectory(platformKnex, null);
            return new NotificationProviderRegistry()
              .register(new WebSocketChannel(gateway))
              .register(new InAppChannel())
              .register(
                new SmtpEmailProvider(smtpConfig, (tenantId, userId) =>
                  userDirectory.getUser(tenantId, userId),
                ),
              )
              .register(new SmsChannel(cfg.NOTIF_SMS_ENABLED))
              .register(new PushChannel(cfg.NOTIF_PUSH_ENABLED));
          },
        },
        // Sprint H — rate limiter (storm protection).
        {
          provide: NotificationRateLimiter,
          inject: [REDIS_TOKEN, NOTIF_CONFIG],
          useFactory: (redis: Redis, cfg: NotificationConfig) =>
            new NotificationRateLimiter({ redis, limitPerMinute: cfg.NOTIF_RATE_LIMIT_PER_MIN }),
        },
        // Sprint H — shared delivery attempt executor.
        {
          provide: DeliveryExecutor,
          inject: [NotificationDeliveryRepository, METRICS_TOKEN, NOTIF_CONFIG],
          useFactory: (
            deliveries: NotificationDeliveryRepository,
            metrics: TelemetryMetrics,
            cfg: NotificationConfig,
          ) =>
            new DeliveryExecutor({
              deliveries,
              metrics,
              maxAttempts: cfg.NOTIF_MAX_DELIVERY_ATTEMPTS,
              retryBaseMs: cfg.NOTIF_RETRY_BASE_MS,
            }),
        },
        // Sprint H — notification dispatcher (per-user fan-out, preferences,
        // templates, idempotency, rate limiting).
        {
          provide: NotificationDispatcherService,
          inject: [
            NotificationRepository,
            NotificationPreferenceRepository,
            NotificationDeliveryRepository,
            NOTIFICATION_PROVIDER_REGISTRY,
            UserDirectory,
            NotificationRateLimiter,
            DeliveryExecutor,
            METRICS_TOKEN,
            NOTIF_CONFIG,
          ],
          useFactory: (
            notifications: NotificationRepository,
            preferences: NotificationPreferenceRepository,
            deliveries: NotificationDeliveryRepository,
            registry: NotificationProviderRegistry,
            userDirectory: UserDirectory,
            rateLimiter: NotificationRateLimiter,
            executor: DeliveryExecutor,
            metrics: TelemetryMetrics,
            cfg: NotificationConfig,
          ) =>
            new NotificationDispatcherService({
              notifications,
              preferences,
              deliveries,
              registry,
              userDirectory,
              rateLimiter,
              executor,
              metrics,
              defaultLocale: cfg.NOTIF_DEFAULT_LOCALE,
              enabled: cfg.NOTIFICATION_ENABLED,
            }),
        },
        // Sprint H — durable delivery retry worker (restart-safe retries).
        {
          provide: DeliveryRetryWorker,
          inject: [
            NotificationDeliveryRepository,
            NOTIFICATION_PROVIDER_REGISTRY,
            DeliveryExecutor,
            METRICS_TOKEN,
            NOTIF_CONFIG,
          ],
          useFactory: (
            deliveries: NotificationDeliveryRepository,
            registry: NotificationProviderRegistry,
            executor: DeliveryExecutor,
            metrics: TelemetryMetrics,
            cfg: NotificationConfig,
          ) =>
            new DeliveryRetryWorker({
              deliveries,
              registry,
              executor,
              metrics,
              intervalMs: cfg.NOTIF_RETRY_WORKER_INTERVAL_MS,
              batchSize: cfg.NOTIF_RETRY_WORKER_BATCH_SIZE,
            }),
        },
        // Alarm evaluator (injects the dispatcher + Sprint G metrics).
        {
          provide: AlarmEvaluatorService,
          inject: [
            AlarmRuleRepository,
            AlarmOccurrenceRepository,
            AlarmStateCache,
            ALARM_REALTIME_GATEWAY,
            NotificationDispatcherService,
            METRICS_TOKEN,
          ],
          useFactory: (
            rules: AlarmRuleRepository,
            alarms: AlarmOccurrenceRepository,
            cache: AlarmStateCache,
            gateway: AlarmRealtimeGateway,
            dispatcher: NotificationDispatcherService,
            metrics: TelemetryMetrics,
          ) =>
            new AlarmEvaluatorService({
              rules,
              alarms,
              stateCache: cache,
              gateway,
              dispatcher,
              metrics,
            }),
        },
        // Sprint G Part 22 — DLQ producer (non-fatal at boot, lazy connect).
        {
          provide: 'ALARM_DLQ_PRODUCER',
          inject: [NOTIF_CONFIG, METRICS_TOKEN],
          useFactory: (cfg: NotificationConfig, metrics: TelemetryMetrics) =>
            new AlarmDlqProducer({
              brokers: cfg.NOTIF_KAFKA_BROKERS.split(','),
              clientId: `${cfg.NOTIF_KAFKA_CLIENT_ID}-dlq`,
              groupId: cfg.NOTIF_KAFKA_GROUP_ID,
              metrics,
            }),
        },
        // Kafka consumer (Sprint G: 3 topics, validation, retry/DLQ, idempotency).
        {
          provide: ALARM_KAFKA_CONSUMER,
          inject: [
            NOTIF_CONFIG,
            AlarmEvaluatorService,
            AlarmStateCache,
            FleetEventRepository,
            'ALARM_DLQ_PRODUCER',
            METRICS_TOKEN,
          ],
          useFactory: (
            cfg: NotificationConfig,
            evaluator: AlarmEvaluatorService,
            stateCache: AlarmStateCache,
            fleetEvents: FleetEventRepository,
            dlq: AlarmDlqProducer,
            metrics: TelemetryMetrics,
          ) =>
            new AlarmKafkaConsumer({
              config: cfg,
              evaluator,
              stateCache,
              fleetEvents,
              dlq,
              metrics,
            }),
        },
      ],
      controllers: [RulesController, AlarmsController, EventsController, NotificationsController],
    };
  }
}
