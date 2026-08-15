import type { TelemetryMetrics } from '@fleetvision/observability';
/**
 * Alarm Kafka consumer — Sprint G.
 *
 * Consumes with its own consumer group:
 *   - fleetvision.telemetry.position.raw      (device-gateway positions)
 *   - fleetvision.telemetry.session.lifecycle (gateway session transitions)
 *   - fleetvision.tracking.events             (gps-engine FleetEvents:
 *     trip/idle/parking boundaries + device-status transitions)
 *
 * Reliability (Part 22 — mirrors the gps-engine Sprint D §15/§19 pattern):
 *   - Envelope validation at the boundary — malformed events are
 *     NON-RETRYABLE → straight to the DLQ; they never crash the consumer.
 *   - Transient failures → bounded in-process retries w/ exponential backoff;
 *     exhausted → DLQ (`<topic>.dlq` suffix convention).
 *   - One bad event never throws to the kafkajs runner.
 *
 * Idempotency (Part 6): every event carries a deterministic eventId; a
 * redelivered event is detected via Redis SET NX and skipped (counted as a
 * duplicate). Tracking events are additionally persisted idempotently to
 * notification.fleet_events (PK = eventId).
 *
 * Non-fatal at boot: the service starts even when Kafka is down (serves
 * REST/WS from existing data).
 */
import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Kafka } from 'kafkajs';
import type { AlarmEvaluatorService } from '../../application/alarm-evaluator.service.js';
import type { InputSignal } from '../../application/evaluators/rule-evaluator.js';
import type { NotificationConfig } from '../../config/notification.config.js';
import type { AlarmStateCache } from '../../infrastructure/cache/alarm-state-cache.js';
import type { FleetEventRepository } from '../../infrastructure/persistence/fleet-event.repository.js';
import type { AlarmDlqProducer } from './alarm-dlq-producer.js';
import {
  EventEnvelopeValidationError,
  parsePositionSignalEnvelope,
  parseSessionSignalEnvelope,
  parseTrackingEventEnvelope,
} from './envelope-validation.js';

export interface AlarmKafkaConsumerDeps {
  readonly config: NotificationConfig;
  readonly evaluator: AlarmEvaluatorService;
  readonly stateCache: AlarmStateCache;
  readonly fleetEvents: FleetEventRepository | null;
  readonly dlq: AlarmDlqProducer | null;
  readonly metrics?: TelemetryMetrics | null;
}

interface ConsumedMessage {
  readonly topic: string;
  readonly partition: number;
  readonly offset: string;
  readonly key: Buffer | null;
  readonly value: Buffer;
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
    if (!this.deps.config.NOTIF_KAFKA_CONSUMER_ENABLED) {
      this.logger.log('Kafka consumer disabled (NOTIF_KAFKA_CONSUMER_ENABLED=false).');
      return;
    }
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
      fromBeginning: config.NOTIF_KAFKA_FROM_BEGINNING,
    });
    await this.consumer.subscribe({
      topic: config.NOTIF_KAFKA_SESSION_TOPIC,
      fromBeginning: config.NOTIF_KAFKA_FROM_BEGINNING,
    });
    await this.consumer.subscribe({
      topic: config.NOTIF_KAFKA_TRACKING_EVENT_TOPIC,
      fromBeginning: config.NOTIF_KAFKA_FROM_BEGINNING,
    });
    this.started = true;
    this.logger.log(
      `Kafka consumer connected — topics: ${config.NOTIF_KAFKA_POSITION_TOPIC}, ${config.NOTIF_KAFKA_SESSION_TOPIC}, ${config.NOTIF_KAFKA_TRACKING_EVENT_TOPIC}`,
    );
    await this.consumer.run({
      eachMessage: (payload) =>
        this.processWithRetry(
          {
            topic: payload.topic,
            partition: payload.partition,
            offset: payload.message.offset,
            key: payload.message.key ?? null,
            value: payload.message.value ?? Buffer.alloc(0),
          },
          () => this.dispatch(payload.topic, payload.message.value ?? Buffer.alloc(0)),
        ),
    });
  }

  /** Route one validated payload to the evaluator + persistence. */
  private async dispatch(topic: string, raw: Buffer): Promise<void> {
    const { config } = this.deps;
    if (topic === config.NOTIF_KAFKA_POSITION_TOPIC) {
      const signal = parsePositionSignalEnvelope(raw);
      await this.handleSignal(signal, 'position', signal.sourceEventId);
      return;
    }
    if (topic === config.NOTIF_KAFKA_SESSION_TOPIC) {
      const signal = parseSessionSignalEnvelope(raw);
      await this.handleSignal(signal, 'session', signal.sourceEventId);
      return;
    }
    if (topic === config.NOTIF_KAFKA_TRACKING_EVENT_TOPIC) {
      const signal = parseTrackingEventEnvelope(raw);
      if (signal === null) return; // valid but not alarm-relevant
      await this.handleSignal(signal, 'tracking', signal.sourceEventId);
      await this.persistFleetEvent(raw, signal);
      return;
    }
    // Subscribed-but-unknown topic — ignore.
  }

  /** Idempotency gate + evaluation dispatch (Part 6). */
  private async handleSignal(
    signal: InputSignal,
    source: 'position' | 'session' | 'tracking',
    eventId: string | null,
  ): Promise<void> {
    this.deps.metrics?.eventsReceived.inc({ source });
    if (eventId !== null) {
      const dup = await this.deps.stateCache.isDuplicateEvent(signal.tenantId, eventId);
      if (dup) {
        this.deps.metrics?.duplicateEvents.inc({ source });
        this.logger.debug(`Duplicate event ${eventId} suppressed (tenant ${signal.tenantId})`);
        return;
      }
    }
    switch (signal.kind) {
      case 'position':
        await this.deps.evaluator.processPosition(signal);
        break;
      case 'device_status':
        await this.deps.evaluator.processDeviceStatus(signal);
        break;
      case 'trip':
        await this.deps.evaluator.processTrip(signal);
        break;
      case 'idle':
        await this.deps.evaluator.processIdle(signal);
        break;
      case 'parking':
        await this.deps.evaluator.processParking(signal);
        break;
    }
    this.deps.metrics?.eventsProcessed.inc({ source });
  }

  /** Persist tracking FleetEvents to the event-history table (idempotent PK). */
  private async persistFleetEvent(raw: Buffer, signal: InputSignal): Promise<void> {
    if (!this.deps.fleetEvents) return;
    try {
      const env = JSON.parse(raw.toString('utf8')) as {
        eventId?: string;
        eventType?: string;
        occurredAt?: string;
        severity?: string | null;
        deviceId?: string | null;
        metadata?: Record<string, unknown>;
      };
      if (!env.eventId || !env.eventType) return;
      await this.deps.fleetEvents.record({
        id: env.eventId,
        tenantId: signal.tenantId,
        vehicleId: signal.vehicleId,
        deviceId: env.deviceId ?? null,
        eventType: env.eventType,
        occurredAt: new Date(env.occurredAt ?? signal.sourceEventId ?? Date.now()),
        severity: env.severity ?? null,
        metadata: env.metadata ?? {},
      });
    } catch (err) {
      // Event history is best-effort — evaluation already succeeded.
      this.logger.warn(`FleetEvent history persist error: ${(err as Error).message}`);
    }
  }

  /**
   * Bounded retry + DLQ (Part 22). Malformed (non-retryable) → DLQ immediately;
   * transient → NOTIF_KAFKA_MAX_ATTEMPTS attempts with exponential backoff,
   * then DLQ. Never throws to the kafkajs runner.
   */
  private async processWithRetry(
    message: ConsumedMessage,
    handler: () => Promise<void>,
  ): Promise<void> {
    const maxAttempts = Math.max(1, this.deps.config.NOTIF_KAFKA_MAX_ATTEMPTS);
    const backoffMs = this.deps.config.NOTIF_KAFKA_RETRY_BACKOFF_MS;
    let attempts = 0;
    let lastError: Error | null = null;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        await handler();
        return;
      } catch (err) {
        lastError = err as Error;
        if (lastError instanceof EventEnvelopeValidationError) break; // non-retryable
        if (attempts < maxAttempts) {
          await sleep(Math.min(backoffMs * 2 ** (attempts - 1), 5_000));
        }
      }
    }

    this.deps.metrics?.eventsFailed.inc({ source: 'tracking' });
    this.logger.warn(
      `Kafka message ${message.topic}:${message.partition}:${message.offset} failed after ${attempts} attempt(s): ${lastError?.message}`,
    );
    if (!this.deps.dlq) return; // DLQ disabled (tests) — drop after logging
    const eventId = extractEventId(message.value);
    await this.deps.dlq.write({
      originalTopic: message.topic,
      partition: message.partition,
      offset: message.offset,
      key: message.key,
      value: message.value,
      reason: lastError?.message ?? 'unknown error',
      errorClass:
        lastError instanceof EventEnvelopeValidationError
          ? 'EventEnvelopeValidationError'
          : (lastError?.name ?? 'Error'),
      attempts,
      eventId,
      correlationId: eventId,
      firstSeen: new Date(),
    });
  }
}

/** Best-effort eventId/correlationId extraction for DLQ headers. */
function extractEventId(value: Buffer): string | null {
  try {
    const env = JSON.parse(value.toString('utf8')) as {
      eventId?: string;
      id?: string;
      messageId?: string;
    };
    return env.eventId ?? env.id ?? env.messageId ?? null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
