import type { TelemetryMetrics } from '@fleetvision/observability';
/**
 * DLQ producer for notification-service — Sprint G Part 22, mirroring the
 * gps-engine Sprint D §15/§16 dead-letter pattern exactly.
 *
 * Messages that fail alarm evaluation after bounded retries (or are
 * structurally invalid — EventEnvelopeValidationError) are republished to
 * `<original-topic>.dlq` with forensic headers. One bad event never crashes
 * the alarm consumer; the partition keeps advancing.
 *
 * Non-fatal by design: if the DLQ write itself fails, the caller retries
 * boundedly and then drops with an ERROR log + metric (documented loss edge).
 */
import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Kafka, type Message, type Producer } from 'kafkajs';

/** A message routed to the DLQ. */
export interface AlarmDlqEntry {
  readonly originalTopic: string;
  readonly partition: number;
  readonly offset: string;
  readonly key: Buffer | null;
  readonly value: Buffer;
  readonly reason: string;
  readonly errorClass: string;
  readonly attempts: number;
  readonly eventId: string | null;
  readonly correlationId: string | null;
  readonly firstSeen: Date;
}

export interface AlarmDlqProducerOptions {
  readonly brokers: readonly string[];
  readonly clientId: string;
  readonly groupId: string;
  readonly metrics?: TelemetryMetrics | null;
}

const REASON_MAX_LEN = 500;
const DLQ_WRITE_ATTEMPTS = 3;

export class AlarmDlqProducer implements OnApplicationShutdown {
  private readonly logger = new Logger('AlarmDlqProducer');
  private readonly kafka: Kafka;
  private readonly metrics: TelemetryMetrics | null;
  private producer: Producer | null = null;
  private connecting: Promise<Producer> | null = null;

  constructor(private readonly options: AlarmDlqProducerOptions) {
    this.metrics = options.metrics ?? null;
    this.kafka = new Kafka({
      brokers: [...options.brokers],
      clientId: options.clientId,
    });
  }

  /** DLQ topic name for an original topic (suffix convention). */
  public dlqTopicFor(originalTopic: string): string {
    return `${originalTopic}.dlq`;
  }

  private async connect(): Promise<Producer> {
    if (this.producer) return this.producer;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const producer = this.kafka.producer({
        idempotent: true,
        allowAutoTopicCreation: false,
      });
      await producer.connect();
      this.producer = producer;
      return producer;
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  /**
   * Write one entry to its DLQ topic with bounded retries. Resolves true on
   * success, false when the DLQ write itself failed (caller drops + logs).
   */
  public async write(entry: AlarmDlqEntry): Promise<boolean> {
    const topic = this.dlqTopicFor(entry.originalTopic);
    const record: Message = {
      key: entry.key,
      value: entry.value,
      headers: {
        'dlq-original-topic': entry.originalTopic,
        'dlq-partition': String(entry.partition),
        'dlq-offset': entry.offset,
        'dlq-failure-reason': entry.reason.slice(0, REASON_MAX_LEN),
        'dlq-error-class': entry.errorClass,
        'dlq-attempts': String(entry.attempts),
        'dlq-first-seen': entry.firstSeen.toISOString(),
        'dlq-consumer-group': this.options.groupId,
        ...(entry.eventId ? { 'event-id': entry.eventId } : {}),
        ...(entry.correlationId ? { 'correlation-id': entry.correlationId } : {}),
      },
    };
    for (let attempt = 1; attempt <= DLQ_WRITE_ATTEMPTS; attempt++) {
      try {
        const producer = await this.connect();
        await producer.send({ topic, messages: [record] });
        this.metrics?.dlqMessages.inc({ topic: 'tracking' });
        return true;
      } catch (err) {
        if (attempt === DLQ_WRITE_ATTEMPTS) {
          this.logger.error(
            `DLQ write failed after ${DLQ_WRITE_ATTEMPTS} attempts for ${entry.originalTopic}:` +
              ` ${(err as Error).message} — message dropped.`,
          );
          return false;
        }
        await sleep(200 * attempt);
      }
    }
    return false;
  }

  public async onApplicationShutdown(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect().catch(() => {});
    }
    this.producer = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
