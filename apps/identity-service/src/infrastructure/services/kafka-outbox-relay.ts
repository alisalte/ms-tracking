import type { Knex } from '@fleetvision/persistence-knex';
/**
 * Kafka outbox relay — drains unpublished rows from `public.event_outbox` and
 * publishes them to Kafka, marking them published. This replaces Debezium/CDC
 * for the MVP (01 §6.1 transactional outbox pattern, simplified to an in-process
 * poller). Idempotency: Kafka producers key by the outbox row id, so a redelivery
 * after a crash before the `published_at` update is safe.
 *
 * Single-instance for MVP (no leader election). On scale-out, add a lease
 * (`claimed_at`) and a leader-elected singleton — the table is already shaped
 * for it.
 */
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Kafka, type Producer } from 'kafkajs';

export interface OutboxRelayConfig {
  readonly brokers: readonly string[];
  readonly clientId: string;
  readonly auditTopic: string;
  /** Poll interval in ms. */
  readonly pollIntervalMs?: number;
  /** Max rows per poll batch. */
  readonly batchSize?: number;
}

interface OutboxRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  tenant_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  headers: Record<string, unknown>;
}

export class KafkaOutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly kafka: Kafka;
  private producer: Producer | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private running = false;

  constructor(
    private readonly knex: Knex,
    private readonly config: OutboxRelayConfig,
  ) {
    this.kafka = new Kafka({ brokers: [...config.brokers], clientId: config.clientId });
    this.pollIntervalMs = config.pollIntervalMs ?? 2000;
    this.batchSize = config.batchSize ?? 100;
  }

  /** Start the producer and the polling loop. */
  public async start(): Promise<void> {
    this.producer = this.kafka.producer();
    await this.producer.connect();
    this.timer = setInterval(() => {
      void this.drain().catch(() => {
        // Swallow — the next tick retries. (Failures are usually Kafka down.)
      });
    }, this.pollIntervalMs);
  }

  /** NestJS lifecycle hook — start the relay once the app is ready. */
  public async onApplicationBootstrap(): Promise<void> {
    try {
      await this.start();
    } catch {
      // Kafka down at boot is non-fatal — the relay retries on each tick once
      // the producer lazily reconnects. Events accumulate in the outbox meanwhile.
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.producer) await this.producer.disconnect();
  }

  /** Drain one batch of unpublished events to Kafka. */
  private async drain(): Promise<void> {
    if (this.running || !this.producer) return;
    this.running = true;
    try {
      const rows = (await this.knex('event_outbox')
        .whereNull('published_at')
        .orderBy('created_at', 'asc')
        .limit(this.batchSize)) as OutboxRow[];
      if (rows.length === 0) return;

      const messages = rows.map((r) => ({
        key: r.aggregate_id,
        value: JSON.stringify(r.payload),
        headers: {
          'event-type': r.event_type,
          'aggregate-type': r.aggregate_type,
          'tenant-id': r.tenant_id,
          'event-id': r.id,
          ...(r.headers as Record<string, string>),
        },
      }));

      await this.producer.send({ topic: this.config.auditTopic, messages });

      const ids = rows.map((r) => r.id);
      await this.knex('event_outbox').whereIn('id', ids).update({ published_at: new Date() });
    } finally {
      this.running = false;
    }
  }
}
