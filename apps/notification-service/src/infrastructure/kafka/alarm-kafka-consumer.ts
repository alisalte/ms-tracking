/**
 * Alarm Kafka consumer — consumes the same telemetry topics as gps-engine-service
 * (position.raw + session.lifecycle) with its own consumer group, routing each
 * message to the AlarmEvaluatorService.
 *
 * Non-fatal at boot: the service starts even when Kafka is down (serves REST/WS
 * from existing data). Mirrors the gps-engine consumer pattern exactly.
 */
import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Kafka } from 'kafkajs';
import type { AlarmEvaluatorService } from '../../application/alarm-evaluator.service.js';
import type { InputSignal } from '../../application/evaluators/rule-evaluator.js';
import type { NotificationConfig } from '../../config/notification.config.js';

export interface AlarmKafkaConsumerDeps {
  readonly config: NotificationConfig;
  readonly evaluator: AlarmEvaluatorService;
}

export class AlarmKafkaConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('AlarmKafkaConsumer');
  private readonly kafka: Kafka;
  private readonly consumer;
  private started = false;

  constructor(private readonly deps: AlarmKafkaConsumerDeps) {
    this.kafka = new Kafka({
      brokers: deps.config.NOTIF_KAFKA_BROKERS.split(','),
      clientId: deps.config.NOTIF_KAFKA_CLIENT_ID,
    });
    this.consumer = this.kafka.consumer({
      groupId: deps.config.NOTIF_KAFKA_GROUP_ID,
      sessionTimeout: 30_000,
      heartbeatInterval: 10_000,
    });
  }

  public async onApplicationBootstrap(): Promise<void> {
    try {
      await this.start();
    } catch (err) {
      this.logger.error(
        `Failed to start Kafka consumer — continuing without alarm evaluation: ${(err as Error).message}`,
      );
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    if (this.started) {
      await this.consumer.disconnect().catch(() => {});
    }
  }

  private async start(): Promise<void> {
    if (this.started) return;
    const { config } = this.deps;
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: config.NOTIF_KAFKA_POSITION_TOPIC,
      fromBeginning: false,
    });
    await this.consumer.subscribe({
      topic: config.NOTIF_KAFKA_SESSION_TOPIC,
      fromBeginning: false,
    });
    this.started = true;
    this.logger.log(
      `Kafka consumer connected — topics: ${config.NOTIF_KAFKA_POSITION_TOPIC}, ${config.NOTIF_KAFKA_SESSION_TOPIC}`,
    );
    await this.consumer.run({ eachMessage: (payload) => this.eachMessage(payload) });
  }

  private async eachMessage(payload: {
    topic: string;
    message: { value: Buffer | null | undefined };
  }): Promise<void> {
    const { topic, message } = payload;
    try {
      if (topic === this.deps.config.NOTIF_KAFKA_POSITION_TOPIC) {
        await this.handlePosition(message.value ?? Buffer.alloc(0));
      } else if (topic === this.deps.config.NOTIF_KAFKA_SESSION_TOPIC) {
        await this.handleSession(message.value ?? Buffer.alloc(0));
      }
    } catch (err) {
      this.logger.warn(`Kafka message error on topic ${topic}: ${(err as Error).message}`);
    }
  }

  private async handlePosition(raw: Buffer): Promise<void> {
    const env = JSON.parse(raw.toString()) as {
      deviceId?: string;
      tenantId?: string;
      timestamp?: string;
      position?: {
        latitude?: number;
        longitude?: number;
        speedKph?: number;
        headingDeg?: number;
        ignitionOn?: boolean | null;
      };
    };
    if (!env.deviceId || !env.tenantId || !env.position?.latitude) return;
    const signal: InputSignal = {
      kind: 'position',
      tenantId: env.tenantId,
      vehicleId: env.deviceId,
      lat: env.position.latitude,
      lng: env.position.longitude ?? 0,
      speedKph: env.position.speedKph ?? 0,
      headingDeg: env.position.headingDeg ?? 0,
      capturedAt: env.timestamp ?? new Date().toISOString(),
      ignitionOn: env.position.ignitionOn ?? null,
    };
    await this.deps.evaluator.processPosition(signal);
  }

  private async handleSession(raw: Buffer): Promise<void> {
    const env = JSON.parse(raw.toString()) as {
      deviceId?: string;
      tenantId?: string;
      state?: string;
      timestamp?: string;
    };
    if (!env.deviceId || !env.tenantId || !env.state) return;
    const signal: InputSignal = {
      kind: 'device_status',
      tenantId: env.tenantId,
      deviceId: env.deviceId,
      state: env.state,
      lastSeenAt: env.timestamp ?? new Date().toISOString(),
    };
    await this.deps.evaluator.processDeviceStatus(signal);
  }
}
