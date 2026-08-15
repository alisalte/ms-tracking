/**
 * KafkaMessageProcessor — bounded-retry + DLQ orchestration for one consumed
 * message (Sprint D §15).
 *
 * Extracted from the consumer so the reliability semantics are unit-testable
 * without a broker:
 *
 *   SUCCESS                        → offset advances (kafkajs auto-commit after
 *                                     eachMessage resolves).
 *   EnvelopeValidationError        → straight to DLQ (a malformed event will
 *                                     never parse; retrying is pointless, §18).
 *   Transient failure              → GPS_KAFKA_MAX_ATTEMPTS in-process retries
 *                                     with exponential backoff; exhausted → DLQ.
 *   DLQ write fails (after its own
 *   bounded retries)               → counted drop with an ERROR log — the
 *                                     documented loss edge (§15).
 *
 * A single bad message NEVER throws to the kafkajs runner: the consumer stays
 * alive and the partition keeps advancing (§19).
 */
import { Logger } from '@nestjs/common';
import type { TelemetryMetrics } from '@fleetvision/observability';
import type { DlqProducer } from './dlq-producer.js';
import { EnvelopeValidationError } from './envelope-parser.js';

export interface ProcessedMessage {
  readonly topic: string;
  readonly partition: number;
  readonly offset: string;
  readonly key: Buffer | null;
  readonly value: Buffer;
}

/** In-memory record of a DLQ'd message (admin observability, §16). */
export interface DlqAuditRecord {
  readonly originalTopic: string;
  readonly partition: number;
  readonly offset: string;
  readonly reason: string;
  readonly errorClass: string;
  readonly attempts: number;
  readonly eventId: string | null;
  readonly correlationId: string | null;
  readonly at: string;
}

export interface MessageProcessorDeps {
  readonly maxAttempts: number;
  readonly retryBackoffMs: number;
  readonly dlq: DlqProducer | null;
  readonly metrics?: TelemetryMetrics | null;
  /** Receives DLQ audit records (the consumer feeds its ring buffer). */
  readonly onDlq?: (record: DlqAuditRecord) => void;
  readonly logger?: Logger;
}

export type MessageOutcome = 'processed' | 'dlq' | 'dropped';

export class KafkaMessageProcessor {
  private readonly logger: Logger;

  constructor(private readonly deps: MessageProcessorDeps) {
    this.logger = deps.logger ?? new Logger('KafkaMessageProcessor');
  }

  /**
   * Run `handler` with bounded retries; route failures to the DLQ. Never
   * throws — always resolves with the outcome.
   */
  public async process(
    message: ProcessedMessage,
    handler: () => Promise<void>,
    logicalTopic: string,
  ): Promise<MessageOutcome> {
    const maxAttempts = Math.max(1, this.deps.maxAttempts);
    let attempts = 0;
    let error: Error;

    try {
      attempts = 1;
      await handler();
      this.deps.metrics?.kafkaConsumed.inc({ topic: logicalTopic, result: 'processed' });
      return 'processed';
    } catch (err) {
      error = err as Error;
      if (!(err instanceof EnvelopeValidationError)) {
        for (attempts = 2; attempts <= maxAttempts; attempts++) {
          await sleep(
            Math.min(this.deps.retryBackoffMs * 2 ** (attempts - 2), 5_000),
          );
          try {
            await handler();
            this.deps.metrics?.kafkaConsumed.inc({ topic: logicalTopic, result: 'processed' });
            this.deps.metrics?.kafkaRetries.inc({ topic: logicalTopic });
            return 'processed';
          } catch (retryErr) {
            // Report the LATEST error to the DLQ (the transient cause may be
            // long gone; what stopped us is what matters for diagnosis).
            error = retryErr as Error;
            if (retryErr instanceof EnvelopeValidationError) {
              attempts--;
              break;
            }
            this.deps.metrics?.kafkaRetries.inc({ topic: logicalTopic });
          }
        }
        // Loop exhausted normally → the last executed attempt is maxAttempts.
        if (attempts > maxAttempts) attempts = maxAttempts;
      }

      return await this.routeToDlq(message, logicalTopic, error, attempts);
    }
  }

  private async routeToDlq(
    message: ProcessedMessage,
    logicalTopic: string,
    error: Error,
    attempts: number,
  ): Promise<MessageOutcome> {
    const { eventId, correlationId } = extractCorrelation(message.value);
    this.deps.onDlq?.({
      originalTopic: message.topic,
      partition: message.partition,
      offset: message.offset,
      reason: error.message,
      errorClass:
        error instanceof EnvelopeValidationError ? 'EnvelopeValidationError' : error.name,
      attempts,
      eventId,
      correlationId,
      at: new Date().toISOString(),
    });

    if (!this.deps.dlq) {
      this.deps.metrics?.kafkaConsumed.inc({ topic: logicalTopic, result: 'dropped' });
      this.logger.error(
        `Message ${message.topic}[${message.partition}]@${message.offset} unprocessable (no DLQ sink): ${error.message}`,
      );
      return 'dropped';
    }
    try {
      await this.deps.dlq.publish(
        {
          originalTopic: message.topic,
          partition: message.partition,
          offset: message.offset,
          key: message.key,
          value: message.value,
          reason: error.message,
          errorClass:
            error instanceof EnvelopeValidationError ? 'EnvelopeValidationError' : error.name,
          attempts,
          eventId,
          correlationId,
          firstSeen: new Date(),
        },
        logicalTopic,
      );
      this.deps.metrics?.kafkaConsumed.inc({ topic: logicalTopic, result: 'dlq' });
      this.logger.error(
        `Message ${message.topic}[${message.partition}]@${message.offset} → DLQ after ${attempts} attempt(s): ${error.message}`,
      );
      return 'dlq';
    } catch (dlqErr) {
      this.deps.metrics?.kafkaConsumed.inc({ topic: logicalTopic, result: 'dropped' });
      this.logger.error(
        `DLQ publish FAILED for ${message.topic}[${message.partition}]@${message.offset} — message dropped: ${(dlqErr as Error).message}`,
      );
      return 'dropped';
    }
  }
}

/** Extract event/correlation ids from a JSON payload (best-effort, never throws). */
export function extractCorrelation(value: Buffer): {
  eventId: string | null;
  correlationId: string | null;
} {
  try {
    const parsed = JSON.parse(value.toString('utf8')) as {
      messageId?: string;
      id?: string;
      correlationId?: string;
    };
    const eventId =
      typeof parsed.messageId === 'string'
        ? parsed.messageId
        : typeof parsed.id === 'string'
          ? parsed.id
          : null;
    const correlationId = typeof parsed.correlationId === 'string' ? parsed.correlationId : null;
    return { eventId, correlationId };
  } catch {
    return { eventId: null, correlationId: null };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
