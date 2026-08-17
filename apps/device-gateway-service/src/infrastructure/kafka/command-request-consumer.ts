/**
 * CommandRequestConsumer — consumes `fleetvision.telemetry.command.request`
 * (06 §11.3 SendDeviceCommand / §11.5 telemetry.command.request.v1) and feeds
 * each request to the CommandDispatcher.
 *
 * Routing model: every gateway instance subscribes with its OWN consumer group
 * (groupId suffixed with the instance id), so each command request is
 * broadcast to all instances. Only the instance holding the device's local
 * session performs the write; the others see `ROUTED_ELSEWHERE` or
 * `DEVICE_OFFLINE` from a single designated instance (the dispatcher stays
 * silent for instances that neither hold the session nor find a global
 * snapshot — see CommandDispatcher.handleNoLocalSession).
 *
 * Non-fatal at boot (mirrors fleet-management's SessionLifecycleConsumer): the
 * gateway serves devices even when Kafka is down; commands simply don't flow.
 */
import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { type Consumer, Kafka } from 'kafkajs';
import type { CommandDispatcher, DeviceCommandRequest } from '../../application/index.js';

export interface CommandRequestConsumerOptions {
  readonly brokers: readonly string[];
  readonly clientId: string;
  /** Per-instance group id suffix — broadcast semantics (route-to-owner). */
  readonly instanceId: string;
  readonly topic: string;
}

interface CommandRequestEnvelope {
  readonly commandId?: string;
  readonly deviceId?: string;
  readonly tenantId?: string | null;
  readonly protocolId?: string;
  readonly commandCode?: string;
  readonly payloadText?: string | null;
  readonly payloadHex?: string | null;
}

export class CommandRequestConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CommandRequestConsumer.name);
  private consumer: Consumer | null = null;
  private started = false;

  constructor(
    private readonly options: CommandRequestConsumerOptions,
    private readonly dispatcher: CommandDispatcher,
  ) {}

  public async onApplicationBootstrap(): Promise<void> {
    await this.start().catch((err) => {
      this.logger.warn(`Command-request consumer not started: ${(err as Error).message}`);
    });
  }

  public async start(): Promise<void> {
    if (this.started) return;
    const kafka = new Kafka({
      brokers: [...this.options.brokers],
      clientId: this.options.clientId,
    });
    this.consumer = kafka.consumer({
      // Per-instance group → every instance sees every request (§6.2 routing).
      groupId: `${this.options.clientId}-cmd-${this.options.instanceId}`,
      sessionTimeout: 30_000,
      heartbeatInterval: 10_000,
    });
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: this.options.topic, fromBeginning: false });
    await this.consumer.run({ eachMessage: (payload) => this.handle(payload.message.value) });
    this.started = true;
    this.logger.log(`Command-request consumer subscribed to '${this.options.topic}'.`);
  }

  private async handle(value: Buffer | null): Promise<void> {
    if (!value) return;
    let envelope: CommandRequestEnvelope;
    try {
      envelope = JSON.parse(value.toString('utf8')) as CommandRequestEnvelope;
    } catch {
      this.logger.warn('Dropping malformed command.request payload (invalid JSON).');
      return;
    }
    if (!envelope.commandId || !envelope.deviceId || !envelope.commandCode) {
      this.logger.warn('Dropping malformed command.request payload (missing ids).');
      return;
    }
    const request: DeviceCommandRequest = {
      commandId: envelope.commandId,
      deviceId: envelope.deviceId,
      tenantId: envelope.tenantId ?? null,
      protocolId: envelope.protocolId ?? 'meitrack',
      commandCode: envelope.commandCode,
      payloadText: envelope.payloadText ?? null,
      payloadHex: envelope.payloadHex ?? null,
    };
    try {
      const result = await this.dispatcher.dispatch(request);
      if (result.outcome === 'REJECTED') {
        this.logger.warn(
          `Command ${request.commandCode} (${request.commandId}) rejected: ${result.reason}.`,
        );
      }
    } catch (err) {
      // Log + advance — the originating service's TTL sweeper expires the
      // command if no SENT feedback ever arrives (at-least-once semantics).
      this.logger.warn(`Command dispatch error (${request.commandId}): ${(err as Error).message}`);
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect().catch(() => {
        /* best-effort */
      });
      this.consumer = null;
      this.started = false;
    }
  }
}
