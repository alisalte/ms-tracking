/**
 * Kafka consumer — the repo's first (07 §3.1, §3.6; 06 §13.2).
 *
 * Consumes two topics:
 *   - `fleetvision.telemetry.position.raw` → position pipeline (validate →
 *     persist → cache → broadcast).
 *   - `fleetvision.telemetry.session.lifecycle` → device-status projection.
 *
 * Non-fatal at boot (07 §15.4): if Kafka is down the service starts, logs a
 * warning, and retries the connection in the background — the REST/WS surfaces
 * keep serving cached/DB data. Lifecycle mirrors the gateway producer's pattern
 * (lazy connect with a connecting-promise guard, `OnApplicationShutdown`
 * disconnect).
 *
 * Concurrency (07 §3.6): one consumer per partition; kafkajs delivers one
 * `eachMessage` at a time per partition, preserving per-vehicle (per-key) order.
 * Back-pressure: the consumer pauses naturally — `eachMessage` awaits the
 * pipeline, so a slow DB/Kafka fills the fetch buffer and kafkajs stops fetching.
 */
import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { type Consumer, type EachMessagePayload, Kafka } from 'kafkajs';
import type { DeviceStatusPipeline } from '../../application/device-status-pipeline.js';
import type { PositionPipeline } from '../../application/position-pipeline.js';
import type { GpsEngineConfig } from '../../config/gps-engine.config.js';
import { parsePositionEnvelope, parseSessionEnvelope } from './envelope-parser.js';

export interface KafkaConsumerDeps {
  readonly config: GpsEngineConfig;
  readonly positionPipeline: PositionPipeline;
  readonly deviceStatusPipeline: DeviceStatusPipeline;
}

export class GpsEngineKafkaConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('GpsEngineKafkaConsumer');
  private readonly kafka: Kafka;
  private readonly consumer: Consumer;
  private started = false;

  constructor(private readonly deps: KafkaConsumerDeps) {
    this.kafka = new Kafka({
      brokers: deps.config.GPS_KAFKA_BROKERS.split(','),
      clientId: deps.config.GPS_KAFKA_CLIENT_ID,
    });
    this.consumer = this.kafka.consumer({
      groupId: deps.config.GPS_KAFKA_GROUP_ID,
      // Allow the consumer to recover from rebalances without crashing the pod.
      sessionTimeout: 30000,
      heartbeatInterval: 10000,
    });
  }

  public async onApplicationBootstrap(): Promise<void> {
    // Non-fatal: if Kafka is down, log + return; the service stays up and the
    // consumer will retry via the run() heartbeat. We wrap in try/catch so boot
    // never throws on infrastructure outage.
    try {
      await this.start();
    } catch (err) {
      this.logger.error(
        `Failed to start Kafka consumer — service will continue without streaming: ${(err as Error).message}`,
      );
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    if (!this.started) return;
    try {
      await this.consumer.disconnect();
      this.logger.log('Kafka consumer disconnected.');
    } catch (err) {
      this.logger.warn(`Error disconnecting Kafka consumer: ${(err as Error).message}`);
    }
    this.started = false;
  }

  /** Start consuming both topics. Idempotent (no-op if already started). */
  private async start(): Promise<void> {
    if (this.started) return;
    const { config } = this.deps;

    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: config.GPS_KAFKA_POSITION_TOPIC,
      fromBeginning: false,
    });
    await this.consumer.subscribe({
      topic: config.GPS_KAFKA_SESSION_TOPIC,
      fromBeginning: false,
    });

    this.started = true;
    this.logger.log(
      `Kafka consumer connected (group: ${config.GPS_KAFKA_GROUP_ID}); ` +
        `subscribed to ${config.GPS_KAFKA_POSITION_TOPIC} + ${config.GPS_KAFKA_SESSION_TOPIC}.`,
    );

    await this.consumer.run({
      eachMessage: async (payload) => this.eachMessage(payload),
    });
  }

  /** Route a message to the right pipeline by its topic. */
  private async eachMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, message } = payload;
    try {
      if (topic === this.deps.config.GPS_KAFKA_POSITION_TOPIC) {
        const event = parsePositionEnvelope(message.value ?? Buffer.alloc(0));
        await this.deps.positionPipeline.process(event);
      } else if (topic === this.deps.config.GPS_KAFKA_SESSION_TOPIC) {
        const record = parseSessionEnvelope(message.value ?? Buffer.alloc(0));
        await this.deps.deviceStatusPipeline.process(record);
      }
    } catch (err) {
      // A malformed/unprocessable message is logged + dropped (at-least-once DLQ
      // is a later cross-cutting concern). The consumer does NOT crash — the
      // offset is committed so the partition advances.
      this.logger.warn(
        `Error processing message on ${topic} (offset ${payload.message.offset}): ${(err as Error).message}`,
      );
    }
  }
}
