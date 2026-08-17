/**
 * CommandRequestProducer — publishes `telemetry.command.request.v1` events on
 * `fleetvision.telemetry.command.request` (06 §11.3 SendDeviceCommand / §6.2
 * downstream command flow). The device-gateway consumes the topic, encodes the
 * payload per the device protocol, and writes it to the live session's socket.
 *
 * Keyed by deviceId for per-device ordering (06 §13.2). Lazy connect +
 * non-fatal at boot — the REST API serves even when Kafka is down (commands
 * fail with a 503 at creation time rather than dangling forever, because the
 * caller's INSERT only commits after a successful publish).
 */
import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Kafka, type Producer } from 'kafkajs';
import type { FleetManagementConfig } from '../../config/fleet-management.config.js';
import type { CommandRequestEvent } from '../../domain/device-command/device-command-types.js';

export class CommandRequestProducer implements OnApplicationShutdown {
  private readonly logger = new Logger('CommandRequestProducer');
  private producer: Producer | null = null;
  private connecting: Promise<Producer> | null = null;
  private connected = false;
  private shutDown = false;

  constructor(private readonly config: FleetManagementConfig) {}

  private async connect(): Promise<Producer> {
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
    const kafka = new Kafka({
      brokers: this.config.FLEET_KAFKA_BROKERS.split(','),
      clientId: this.config.FLEET_KAFKA_CLIENT_ID,
    });
    const producer = kafka.producer({ idempotent: true, allowAutoTopicCreation: false });
    producer.on(producer.events.CONNECT, () => {
      this.connected = true;
    });
    producer.on(producer.events.DISCONNECT, () => {
      this.connected = false;
    });
    await producer.connect();
    this.producer = producer;
    this.connected = true;
    this.logger.log('Command-request producer connected.');
    return producer;
  }

  /** Publish one command request (keyed by deviceId). Throws on failure. */
  public async publish(event: CommandRequestEvent): Promise<void> {
    const producer = await this.connect();
    await producer.send({
      topic: this.config.FLEET_KAFKA_COMMAND_REQUEST_TOPIC,
      messages: [
        {
          key: event.deviceId,
          value: JSON.stringify({
            specversion: '1.0',
            type: 'telemetry.command.request.v1',
            time: new Date().toISOString(),
            id: event.commandId,
            correlationId: event.commandId,
            ...event,
          }),
          headers: {
            'event-type': 'telemetry.command.request.v1',
            'message-id': event.commandId,
            'tenant-id': event.tenantId,
            'device-id': event.deviceId,
            'protocol-id': event.protocolId,
          },
        },
      ],
    });
  }

  public async onApplicationShutdown(): Promise<void> {
    this.shutDown = true;
    void this.shutDown;
    if (this.producer && this.connected) {
      await this.producer.disconnect().catch(() => {
        /* best-effort */
      });
    }
    this.connected = false;
    this.producer = null;
  }
}
