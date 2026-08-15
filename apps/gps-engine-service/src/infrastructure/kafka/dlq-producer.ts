import type { TelemetryMetrics } from '@fleetvision/observability';
/**
 * DLQ producer — the dead-letter sink for unprocessable messages (Sprint D §15/§16).
 *
 * Messages that fail processing after bounded retries (or are structurally
 * invalid — EnvelopeValidationError) are republished to `<original-topic>.dlq`
 * with forensic headers:
 *
 *   dlq-original-topic / -partition / -offset   — provenance
 *   dlq-failure-reason / -error-class           — diagnosis (truncated)
 *   dlq-attempts / -first-seen                  — retry history
 *   event-id / correlation-id                   — best-effort correlation (§34)
 *
 * DLQ records must NOT contain secrets (§16): telemetry envelopes carry no
 * credentials — only device identity + position payloads, which are exactly the
 * diagnostic content needed to reprocess.
 *
 * Non-fatal by design: if the DLQ write itself fails (Kafka down), the caller
 * retries a bounded number of times and then drops with an ERROR log + metric —
 * documented data-loss edge (blocking the partition forever on a poison DLQ
 * write would be worse).
 */
import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Kafka, type Message, type Producer } from 'kafkajs';

/** A message routed to the DLQ. */
export interface DlqEntry {
  readonly originalTopic: string;
  readonly partition: number;
  readonly offset: string;
  /** Original message key (preserved for partition-order diagnosis). */
  readonly key: Buffer | null;
  /** Original message value (the diagnostic payload). */
  readonly value: Buffer;
  readonly reason: string;
  readonly errorClass: string;
  readonly attempts: number;
  readonly eventId: string | null;
  readonly correlationId: string | null;
  readonly firstSeen: Date;
}

export interface DlqProducerOptions {
  readonly brokers: readonly string[];
  readonly clientId: string;
  /** Consumer-group id recorded in the DLQ headers for traceability. */
  readonly groupId: string;
  readonly metrics?: TelemetryMetrics;
}

const REASON_MAX_LEN = 500;

export class DlqProducer implements OnApplicationShutdown {
  private readonly logger = new Logger('DlqProducer');
  private readonly kafka: Kafka;
  private readonly metrics: TelemetryMetrics | null;
  private producer: Producer | null = null;
  private connecting: Promise<Producer> | null = null;

  constructor(private readonly options: DlqProducerOptions) {
    this.metrics = options.metrics ?? null;
    this.kafka = new Kafka({
      brokers: [...options.brokers],
      clientId: options.clientId,
    });
  }

  /** DLQ topic name for an original topic (§17 — suffix convention). */
  public dlqTopicFor(originalTopic: string): string {
    return `${originalTopic}.dlq`;
  }

  /** Lazily connect + ensure the DLQ topics exist (allowAutoTopicCreation=false). */
  public async connect(): Promise<Producer> {
    if (this.producer) return this.producer;
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async doConnect(): Promise<Producer> {
    const producer = this.kafka.producer({
      idempotent: true,
      allowAutoTopicCreation: false,
    });
    producer.on(producer.events.DISCONNECT, () => {
      this.producer = null;
    });
    await producer.connect();
    this.producer = producer;
    this.logger.log('DLQ producer connected.');
    return producer;
  }

  /**
   * Create the DLQ topics if missing (idempotent). Called once at boot; a
   * failure is logged and retried lazily by the first publish (non-fatal).
   */
  public async ensureTopics(topics: readonly string[]): Promise<void> {
    const dlqTopics = topics.map((t) => this.dlqTopicFor(t));
    try {
      const admin = this.kafka.admin();
      try {
        await admin.connect();
        await admin.createTopics({
          topics: dlqTopics.map((topic) => ({ topic, numPartitions: 1 })),
          waitForLeaders: false,
        });
      } finally {
        await admin.disconnect().catch(() => {});
      }
      this.logger.log(`DLQ topics ensured: ${dlqTopics.join(', ')}.`);
    } catch (err) {
      this.logger.warn(
        `Could not ensure DLQ topics (${dlqTopics.join(', ')}) — will retry on first DLQ publish: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Publish a DLQ entry. `logicalTopic` is the bounded metric label ('position'
   * | 'session'). Throws after bounded internal retries (the caller decides
   * drop-vs-fatal; the consumer drops with an ERROR log + metric).
   */
  public async publish(entry: DlqEntry, logicalTopic: string): Promise<void> {
    const topic = this.dlqTopicFor(entry.originalTopic);
    const record: Message = {
      key: entry.key,
      value: entry.value,
      headers: {
        'dlq-original-topic': entry.originalTopic,
        'dlq-original-partition': String(entry.partition),
        'dlq-original-offset': entry.offset,
        'dlq-failure-reason': entry.reason.slice(0, REASON_MAX_LEN),
        'dlq-error-class': entry.errorClass,
        'dlq-attempts': String(entry.attempts),
        'dlq-first-seen': entry.firstSeen.toISOString(),
        'dlq-source-group': this.options.groupId,
        ...(entry.eventId ? { 'event-id': entry.eventId } : {}),
        ...(entry.correlationId ? { 'correlation-id': entry.correlationId } : {}),
      },
    };
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const producer = await this.connect();
        await producer.send({ topic, messages: [record] });
        this.metrics?.dlqMessages.inc({ topic: logicalTopic });
        return;
      } catch (err) {
        lastError = err;
        await sleep(Math.min(250 * 2 ** (attempt - 1), 1000));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  public async onApplicationShutdown(): Promise<void> {
    if (this.producer) {
      try {
        await this.producer.disconnect();
      } catch (err) {
        this.logger.warn(`Error disconnecting DLQ producer: ${(err as Error).message}`);
      }
    }
    this.producer = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
