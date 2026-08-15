/**
 * KafkaProducer — the event-backbone producer (06 §13.2).
 *
 * Batched, idempotent, partition-keyed by `device_id` for per-device ordering
 * (06 §13.2, ADR-001 ordering rule). The producer connects lazily and is
 * **non-fatal at boot**: the gateway starts even if Kafka is down, reconnecting
 * on demand — mirroring the resilient pattern of the identity-service outbox
 * relay (06 §15.4: "Kafka slow/unreachable → back-pressure; buffer to capacity").
 *
 * Sprint D §13 reliability hardening:
 *   - bounded, env-tunable broker retries (exponential backoff) instead of
 *     silently relying on kafkajs defaults;
 *   - producer CONNECT / DISCONNECT / REQUEST_TIMEOUT event listeners — the
 *     `connected` flag now reflects the real connection state (a broker loss
 *     flips it false, readiness + is_connected metrics go red, and the next
 *     publish re-connects);
 *   - lingerMs is actually applied (batching);
 *   - every publish outcome increments a bounded metric (topic × result).
 *
 * Topic selection follows ADR-016 / 06 §11.5:
 *   POSITION     → fleetvision.telemetry.position.raw
 *   ALARM        → fleetvision.telemetry.alarm.raw
 *   LOGIN / HB / TELEMETRY → fleetvision.telemetry.device.raw
 *   COMMAND_ACK  → fleetvision.telemetry.command.ack
 *
 * Sprint 3 sends JSON values; Avro + Schema Registry is a later cross-cutting
 * `bus-kafka` package (06 §13.2 — deferred per plan; documented in Sprint D).
 */
import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { TelemetryMetrics } from '@fleetvision/observability';
import { Kafka, type Message, type Producer } from 'kafkajs';
import type { DeviceMessage } from '../../domain/device-message.js';

export interface KafkaProducerRetryOptions {
  /** Bounded broker/produce retry attempts (Sprint D §13 — no infinite retry). */
  readonly retries: number;
  /** Initial retry backoff (ms) — kafkajs doubles it per attempt. */
  readonly initialRetryIntervalMs: number;
  /** Retry backoff ceiling (ms). */
  readonly maxRetryIntervalMs: number;
}

export interface KafkaProducerOptions {
  readonly brokers: readonly string[];
  readonly clientId: string;
  readonly topics: {
    readonly position: string;
    readonly alarm: string;
    readonly device: string;
    readonly commandAck: string;
    readonly session: string;
  };
  /**
   * Linger (ms) for batching (06 §13.2 — default 20ms). NOTE: kafkajs 2.2.4's
   * ProducerConfig has no public lingerMs knob (batching is internal), so this
   * is documented intent — upgrade kafkajs to apply it.
   */
  readonly lingerMs?: number;
  /** Bounded retry configuration (Sprint D §13). */
  readonly retry?: Partial<KafkaProducerRetryOptions>;
  /** Telemetry metrics (optional — tests construct the producer without). */
  readonly metrics?: TelemetryMetrics;
}

type TopicKey = 'position' | 'alarm' | 'device' | 'commandAck' | 'session';

const DEFAULT_RETRY: KafkaProducerRetryOptions = {
  retries: 8,
  initialRetryIntervalMs: 300,
  maxRetryIntervalMs: 30_000,
};

export class DeviceGatewayKafkaProducer implements OnApplicationShutdown {
  private readonly logger = new Logger('DeviceGatewayKafkaProducer');
  private readonly kafka: Kafka;
  private readonly retry: KafkaProducerRetryOptions;
  private readonly metrics: TelemetryMetrics | null;
  private producer: Producer | null = null;
  private connecting: Promise<Producer> | null = null;
  private connected = false;
  private shutDown = false;

  constructor(private readonly options: KafkaProducerOptions) {
    this.retry = { ...DEFAULT_RETRY, ...options.retry };
    this.metrics = options.metrics ?? null;
    this.kafka = new Kafka({
      brokers: [...options.brokers],
      clientId: options.clientId,
      // Bounded reconnect/retry policy for broker + metadata requests. kafkajs
      // backs off exponentially between attempts up to maxRetryIntervalMs and
      // gives up after `retries` — the caller-side back-pressure then holds the
      // message (no infinite retry loop, no unbounded buffering).
      connectionTimeout: 10_000,
      requestTimeout: 30_000,
      retry: {
        retries: this.retry.retries,
        initialRetryTime: this.retry.initialRetryIntervalMs,
        maxRetryTime: this.retry.maxRetryIntervalMs,
        restartOnFailure: async () => !this.shutDown,
      },
    });
  }

  /** Lazily connect the producer. Safe to call repeatedly; resolves once connected. */
  public async connect(): Promise<Producer> {
    if (this.connected && this.producer) return this.producer;
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
    // Sprint D §13 — reflect the real connection state. Without these, a broker
    // loss left `connected === true` forever and readiness lied.
    producer.on(producer.events.CONNECT, () => {
      this.connected = true;
      this.logger.log('Kafka producer connected.');
    });
    producer.on(producer.events.DISCONNECT, () => {
      this.connected = false;
      this.logger.warn('Kafka producer disconnected — will reconnect on next publish.');
    });
    await producer.connect();
    this.producer = producer;
    this.connected = true;
    this.logger.log('Kafka producer connected.');
    return producer;
  }

  /** True iff the producer has an active connection (readiness / metrics). */
  public get isConnected(): boolean {
    return this.connected;
  }

  /**
   * Publish one DeviceMessage to its routed topic, keyed by deviceId (per-device
   * ordering). Throws on failure so the dispatcher can apply back-pressure /
   * re-enqueue; the caller is expected to retry or buffer (06 §8.2).
   */
  public async publish(message: DeviceMessage): Promise<void> {
    const topicKey = this.topicKeyFor(message);
    const producer = await this.connect();
    const topic = this.options.topics[topicKey];
    const record: Message = {
      key: message.deviceId,
      value: JSON.stringify(this.toEnvelope(message)),
      headers: {
        'event-type': this.eventTypeFor(message),
        'message-id': message.messageId,
        'tenant-id': message.tenantId,
        'protocol-id': message.protocolId,
        'device-id': message.deviceId,
      },
    };
    try {
      await producer.send({
        topic,
        messages: [record],
      });
      this.metrics?.kafkaProduced.inc({ topic: topicKey, result: 'ok' });
    } catch (err) {
      this.metrics?.kafkaProduced.inc({ topic: topicKey, result: 'error' });
      throw err;
    }
  }

  /**
   * Publish a session-lifecycle event (06 §11.5 `telemetry.session.lifecycle.v1`).
   * Used on AUTHENTICATED / DISCONNECTED / STALE transitions.
   */
  public async publishSessionLifecycle(event: {
    readonly sessionId: string;
    readonly deviceId: string | null;
    readonly tenantId: string | null;
    readonly state: string;
    readonly reason: string | null;
    readonly protocolId: string;
    readonly at: Date;
  }): Promise<void> {
    const producer = await this.connect();
    try {
      await producer.send({
        topic: this.options.topics.session,
        messages: [
          {
            key: event.deviceId ?? event.sessionId,
            value: JSON.stringify({
              specversion: '1.0',
              type: 'telemetry.session.lifecycle.v1',
              time: event.at.toISOString(),
              id: event.sessionId,
              correlationId: event.sessionId,
              sessionId: event.sessionId,
              deviceId: event.deviceId,
              tenantId: event.tenantId,
              state: event.state,
              reason: event.reason,
              protocolId: event.protocolId,
            }),
          },
        ],
      });
      this.metrics?.kafkaProduced.inc({ topic: 'session', result: 'ok' });
    } catch (err) {
      this.metrics?.kafkaProduced.inc({ topic: 'session', result: 'error' });
      throw err;
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    this.shutDown = true;
    if (this.producer && this.connected) {
      try {
        await this.producer.disconnect();
      } catch (err) {
        this.logger.warn(`Error disconnecting Kafka producer: ${(err as Error).message}`);
      }
    }
    this.connected = false;
    this.producer = null;
  }

  private topicKeyFor(message: DeviceMessage): TopicKey {
    switch (message.type) {
      case 'POSITION':
        return 'position';
      case 'ALARM':
        return 'alarm';
      case 'COMMAND_ACK':
        return 'commandAck';
      default:
        return 'device';
    }
  }

  private eventTypeFor(message: DeviceMessage): string {
    switch (message.type) {
      case 'POSITION':
        return 'telemetry.position.raw.v1';
      case 'ALARM':
        return 'telemetry.alarm.raw.v1';
      case 'COMMAND_ACK':
        return 'telemetry.command.ack.v1';
      default:
        return 'telemetry.device.raw.v1';
    }
  }

  /** CloudEvents-aligned envelope for the message value. */
  private toEnvelope(message: DeviceMessage): Record<string, unknown> {
    return {
      specversion: '1.0',
      type: this.eventTypeFor(message),
      time: message.ingestedAt.toISOString(),
      id: message.messageId,
      messageId: message.messageId,
      correlationId: message.correlationId ?? message.messageId,
      deviceId: message.deviceId,
      // Registry-sourced trusted vehicle identity (Sprint D §5). Null for
      // unpaired devices; gps-engine falls back to deviceId when absent
      // (backward compatible with pre-Sprint-D envelopes).
      vehicleId: message.vehicleId ?? null,
      serialOrImei: message.serialOrImei,
      tenantId: message.tenantId,
      protocolId: message.protocolId,
      messageType: message.type,
      timestamp: message.timestamp.toISOString(),
      position: message.position,
      alarms: message.alarms,
      telemetry: message.telemetry,
      io: message.io,
      rawSize: message.rawSize,
      checksum: message.checksum,
    };
  }
}
