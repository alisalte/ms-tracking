/**
 * Kafka consumer — position + session-lifecycle ingestion (07 §3.1, §3.6; 06 §13.2).
 *
 * Consumes two topics:
 *   - `fleetvision.telemetry.position.raw` → position pipeline (validate →
 *     persist → cache → trip → broadcast).
 *   - `fleetvision.telemetry.session.lifecycle` → device-status projection.
 *
 * Sprint D §14/§15/§19 reliability semantics (VERIFIED behavior, not aspiration):
 *
 *   Delivery: at-least-once. Offsets auto-commit AFTER `eachMessage` resolves —
 *   a message resolves only once it is (a) processed, (b) DLQ'd, or (c) dropped
 *   after exhausted DLQ retries (error-logged + counted; the only loss path).
 *   A crash mid-processing redelivers (idempotent pipelines make that safe).
 *
 *   Retry/DLQ orchestration lives in `KafkaMessageProcessor` (unit-tested):
 *   transient failures get bounded in-process retries; structural failures
 *   (EnvelopeValidationError) go straight to the DLQ.
 *
 *   Crash containment (§19): a single bad event NEVER crashes the process.
 *
 *   Boot resilience: non-fatal at boot — and a failed `start()` is RETRIED with
 *   capped backoff until shutdown (Sprint D fixed the latent bug where a Kafka
 *   outage at boot left the consumer dead for the pod's lifetime).
 *
 * Concurrency (07 §3.6): one consumer per partition; kafkajs delivers one
 * `eachMessage` at a time per partition, preserving per-vehicle (per-key) order.
 * Back-pressure: `eachMessage` awaits the pipeline, so kafkajs stops fetching
 * when downstream is slow.
 */
import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { TelemetryMetrics } from '@fleetvision/observability';
import { type Consumer, type EachMessagePayload, Kafka } from 'kafkajs';
import type { DeviceStatusPipeline } from '../../application/device-status-pipeline.js';
import type { PositionPipeline } from '../../application/position-pipeline.js';
import type { GpsEngineConfig } from '../../config/gps-engine.config.js';
import type { DlqProducer } from './dlq-producer.js';
import {
  type DlqAuditRecord,
  KafkaMessageProcessor,
} from './message-processor.js';

export type { DlqAuditRecord };
import { parsePositionEnvelope, parseSessionEnvelope } from './envelope-parser.js';

export interface KafkaConsumerDeps {
  readonly config: GpsEngineConfig;
  readonly positionPipeline: PositionPipeline;
  readonly deviceStatusPipeline: DeviceStatusPipeline;
  /** Dead-letter sink (optional in tests; absent → failures are dropped+logged). */
  readonly dlq?: DlqProducer | null;
  /** Telemetry metrics (optional). */
  readonly metrics?: TelemetryMetrics | null;
}

const DLQ_AUDIT_RING_SIZE = 100;

export class GpsEngineKafkaConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('GpsEngineKafkaConsumer');
  private readonly kafka: Kafka;
  private readonly consumer: Consumer;
  private readonly metrics: TelemetryMetrics | null;
  private readonly processor: KafkaMessageProcessor;
  private started = false;
  private starting = false;
  private shutDown = false;
  private startRetryTimer: NodeJS.Timeout | null = null;
  private startAttempts = 0;
  /** Last N DLQ records (admin endpoint — metadata only, no payloads). */
  private readonly dlqAudit: DlqAuditRecord[] = [];

  constructor(private readonly deps: KafkaConsumerDeps) {
    this.kafka = new Kafka({
      brokers: deps.config.GPS_KAFKA_BROKERS.split(','),
      clientId: deps.config.GPS_KAFKA_CLIENT_ID,
      // Bounded broker reconnects; the consumer group's own session/heartbeat
      // machinery handles rebalance recovery.
      retry: {
        retries: 8,
        initialRetryTime: 300,
        maxRetryTime: 30_000,
      },
    });
    this.consumer = this.kafka.consumer({
      groupId: deps.config.GPS_KAFKA_GROUP_ID,
      // Allow the consumer to recover from rebalances without crashing the pod.
      sessionTimeout: 30000,
      heartbeatInterval: 10000,
    });
    this.metrics = deps.metrics ?? null;
    this.processor = new KafkaMessageProcessor({
      maxAttempts: deps.config.GPS_KAFKA_MAX_ATTEMPTS,
      retryBackoffMs: deps.config.GPS_KAFKA_RETRY_BACKOFF_MS,
      dlq: deps.dlq ?? null,
      metrics: this.metrics,
      onDlq: (record) => this.recordDlqAudit(record),
      logger: this.logger,
    });
  }

  /** True once the consumer is connected + subscribed + running (readiness §35). */
  public get isRunning(): boolean {
    return this.started;
  }

  /** Recent DLQ records (metadata only — admin endpoint, §16). */
  public get dlqAuditRecords(): readonly DlqAuditRecord[] {
    return [...this.dlqAudit];
  }

  public async onApplicationBootstrap(): Promise<void> {
    // Non-fatal: if Kafka is down, log + schedule a capped-backoff retry — the
    // service stays up and the REST/WS surfaces keep serving (07 §15.4). The
    // retry loop replaces the old behavior where a boot-time outage left the
    // consumer dead until pod restart.
    await this.tryStart();
  }

  private async tryStart(): Promise<void> {
    if (this.shutDown || this.started || this.starting) return;
    this.starting = true;
    try {
      await this.start();
      this.startAttempts = 0;
    } catch (err) {
      this.logger.error(
        `Failed to start Kafka consumer (attempt ${this.startAttempts + 1}) — ${this.shutDown ? 'shutting down' : 'will retry with backoff'}: ${(err as Error).message}`,
      );
      this.scheduleStartRetry();
    } finally {
      this.starting = false;
    }
  }

  private scheduleStartRetry(): void {
    if (this.shutDown) return;
    this.startAttempts++;
    const backoffMs = Math.min(2000 * 2 ** Math.min(this.startAttempts, 5), 60_000);
    this.startRetryTimer = setTimeout(() => {
      this.startRetryTimer = null;
      void this.tryStart();
    }, backoffMs);
  }

  public async onApplicationShutdown(): Promise<void> {
    this.shutDown = true;
    if (this.startRetryTimer) {
      clearTimeout(this.startRetryTimer);
      this.startRetryTimer = null;
    }
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

    // Ensure DLQ topics exist before the first failure needs them (non-fatal).
    if (this.deps.dlq) {
      await this.deps.dlq.ensureTopics([
        config.GPS_KAFKA_POSITION_TOPIC,
        config.GPS_KAFKA_SESSION_TOPIC,
      ]);
    }

    await this.consumer.run({
      eachMessage: async (payload) => this.eachMessage(payload),
    });
  }

  /** Route a message to the right pipeline by its topic, with retry + DLQ. */
  private async eachMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, message, partition } = payload;
    const logical = this.logicalTopicFor(topic);
    const startedAt = Date.now();
    const value = message.value ?? Buffer.alloc(0);

    await this.processor.process(
      {
        topic,
        partition,
        offset: message.offset,
        key: message.key ?? null,
        value,
      },
      async () => {
        if (logical === 'position') {
          const event = parsePositionEnvelope(value);
          await this.deps.positionPipeline.process(event);
        } else if (logical === 'session') {
          const record = parseSessionEnvelope(value);
          await this.deps.deviceStatusPipeline.process(record);
        }
      },
      logical,
    );

    if (logical === 'position') {
      this.metrics?.processingLatency.observe(
        { topic: logical },
        (Date.now() - startedAt) / 1000,
      );
    }
  }

  private recordDlqAudit(record: DlqAuditRecord): void {
    this.dlqAudit.push(record);
    if (this.dlqAudit.length > DLQ_AUDIT_RING_SIZE) {
      this.dlqAudit.splice(0, this.dlqAudit.length - DLQ_AUDIT_RING_SIZE);
    }
  }

  private logicalTopicFor(topic: string): 'position' | 'session' | 'unknown' {
    if (topic === this.deps.config.GPS_KAFKA_POSITION_TOPIC) return 'position';
    if (topic === this.deps.config.GPS_KAFKA_SESSION_TOPIC) return 'session';
    return 'unknown';
  }
}
