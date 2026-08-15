/**
 * NotificationModule — wires the Alarm Engine + Notification delivery tier:
 * Kafka consumer, evaluator, dispatcher, repositories, WS gateway, REST controllers.
 */
import {
  AuthModule,
  TOKEN_VERIFIER,
  type TokenVerifier,
  jwtAuthGuardProvider,
} from '@fleetvision/auth';
import { REDIS_TOKEN } from '@fleetvision/cache-redis';
import type { Redis } from '@fleetvision/cache-redis';
import { KNEX_TOKEN, PLATFORM_KNEX_TOKEN } from '@fleetvision/persistence-knex';
import type { Knex } from '@fleetvision/persistence-knex';
import { type DynamicModule, Module } from '@nestjs/common';
import { AlarmEvaluatorService } from '../application/alarm-evaluator.service.js';
import { EmailChannel, InAppChannel, WebSocketChannel } from '../application/channels/channels.js';
import { NotificationDispatcherService } from '../application/notification-dispatcher.service.js';
import type { NotificationConfig } from '../config/notification.config.js';
import { AlarmStateCache } from '../infrastructure/cache/alarm-state-cache.js';
import { AlarmKafkaConsumer } from '../infrastructure/kafka/alarm-kafka-consumer.js';
import { AlarmOccurrenceRepository } from '../infrastructure/persistence/alarm-occurrence.repository.js';
import { AlarmRuleRepository } from '../infrastructure/persistence/alarm-rule.repository.js';
import { GeofenceQuery } from '../infrastructure/persistence/geofence-query.js';
import { NotificationDeliveryRepository } from '../infrastructure/persistence/notification-delivery.repository.js';
import { NotificationPreferenceRepository } from '../infrastructure/persistence/notification-preference.repository.js';
import { NotificationRepository } from '../infrastructure/persistence/notification.repository.js';
import { AlarmRealtimeGateway } from '../infrastructure/websocket/alarm-realtime.gateway.js';
import { AlarmsController } from './alarms.controller.js';
import { NotificationsController } from './notifications.controller.js';
import { RulesController } from './rules.controller.js';

export const NOTIF_CONFIG = 'NOTIF_CONFIG';
export const ALARM_KAFKA_CONSUMER = 'ALARM_KAFKA_CONSUMER';
export const ALARM_REALTIME_GATEWAY = 'ALARM_REALTIME_GATEWAY';

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
        jwtAuthGuardProvider(),
        { provide: NOTIF_CONFIG, useValue: config },
        // Alarm repositories.
        {
          provide: AlarmRuleRepository,
          inject: [KNEX_TOKEN],
          useFactory: (knex: Knex) => new AlarmRuleRepository(knex),
        },
        {
          provide: AlarmOccurrenceRepository,
          inject: [KNEX_TOKEN],
          useFactory: (knex: Knex) => new AlarmOccurrenceRepository(knex),
        },
        {
          provide: GeofenceQuery,
          inject: [KNEX_TOKEN],
          useFactory: (knex: Knex) => new GeofenceQuery(knex),
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
          inject: [KNEX_TOKEN],
          useFactory: (knex: Knex) => new NotificationDeliveryRepository(knex),
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
        // Notification dispatcher (delivery tier).
        {
          provide: NotificationDispatcherService,
          inject: [
            NotificationRepository,
            NotificationPreferenceRepository,
            NotificationDeliveryRepository,
            ALARM_REALTIME_GATEWAY,
          ],
          useFactory: (
            notifications: NotificationRepository,
            preferences: NotificationPreferenceRepository,
            deliveries: NotificationDeliveryRepository,
            gateway: AlarmRealtimeGateway,
          ) => {
            const channels = [
              new WebSocketChannel(gateway),
              new InAppChannel(),
              new EmailChannel(smtpConfig, async () => null), // getUserEmail stub — no user lookup in this service.
            ];
            return new NotificationDispatcherService({
              notifications,
              preferences,
              deliveries,
              channels,
            });
          },
        },
        // Alarm evaluator (injects the dispatcher).
        {
          provide: AlarmEvaluatorService,
          inject: [
            AlarmRuleRepository,
            AlarmOccurrenceRepository,
            AlarmStateCache,
            GeofenceQuery,
            ALARM_REALTIME_GATEWAY,
            NotificationDispatcherService,
          ],
          useFactory: (
            rules: AlarmRuleRepository,
            alarms: AlarmOccurrenceRepository,
            cache: AlarmStateCache,
            geofenceQuery: GeofenceQuery,
            gateway: AlarmRealtimeGateway,
            dispatcher: NotificationDispatcherService,
          ) =>
            new AlarmEvaluatorService({
              rules,
              alarms,
              stateCache: cache,
              geofenceQuery,
              gateway,
              dispatcher,
            }),
        },
        // Kafka consumer.
        {
          provide: ALARM_KAFKA_CONSUMER,
          inject: [NOTIF_CONFIG, AlarmEvaluatorService],
          useFactory: (cfg: NotificationConfig, evaluator: AlarmEvaluatorService) =>
            new AlarmKafkaConsumer({ config: cfg, evaluator }),
        },
      ],
      controllers: [RulesController, AlarmsController, NotificationsController],
    };
  }
}
