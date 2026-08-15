/**
 * SessionLifecycleConsumer — projects the device-gateway's
 * `telemetry.session.lifecycle.v1` events onto `fleet.devices` connection state
 * (Sprint C §21): AUTHENTICATED/ACTIVE → connected_at + last_seen_at;
 * DISCONNECTED → disconnected_at + last_seen_at.
 *
 * This keeps the gateway a pure producer (no fleet-schema knowledge) and reuses
 * the existing Kafka event model (§29) — no new event architecture. It is NOT
 * called per packet: the gateway only emits lifecycle TRANSITIONS. Per-packet
 * liveness stays in Redis + tracking.device_status (projected by gps-engine).
 *
 * Non-fatal at boot (mirrors the gps-engine consumer): the REST API serves even
 * when Kafka is down; the consumer retries via the run() heartbeat.
 */
import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { type Consumer, type EachMessagePayload, Kafka } from 'kafkajs';
import type { FleetManagementConfig } from '../../config/fleet-management.config.js';
import type { DeviceRepository } from '../persistence/device.repository.js';

/** Raw session-lifecycle envelope (06 §13.2 publishSessionLifecycle). */
interface SessionEnvelope {
  readonly deviceId?: string | null;
  readonly tenantId?: string | null;
  readonly state?: string;
  readonly reason?: string | null;
  readonly protocolId?: string;
  readonly time?: string;
}

export class SessionLifecycleConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('SessionLifecycleConsumer');
  private readonly kafka: Kafka;
  private readonly consumer: Consumer;
  private started = false;

  constructor(
    private readonly config: FleetManagementConfig,
    private readonly devices: DeviceRepository,
  ) {
    this.kafka = new Kafka({
      brokers: this.config.FLEET_KAFKA_BROKERS.split(','),
      clientId: this.config.FLEET_KAFKA_CLIENT_ID,
    });
    this.consumer = this.kafka.consumer({
      groupId: this.config.FLEET_KAFKA_GROUP_ID,
      sessionTimeout: 30000,
      heartbeatInterval: 10000,
    });
  }

  public async onApplicationBootstrap(): Promise<void> {
    try {
      await this.start();
    } catch (err) {
      this.logger.error(
        `Failed to start Kafka consumer — connection-state projection paused: ${(err as Error).message}`,
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

  private async start(): Promise<void> {
    if (this.started) return;
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: this.config.FLEET_KAFKA_SESSION_TOPIC,
      fromBeginning: false,
    });
    this.started = true;
    this.logger.log(
      `Kafka consumer connected (group: ${this.config.FLEET_KAFKA_GROUP_ID}); subscribed to ${this.config.FLEET_KAFKA_SESSION_TOPIC}.`,
    );
    await this.consumer.run({ eachMessage: (p) => this.eachMessage(p) });
  }

  private async eachMessage(payload: EachMessagePayload): Promise<void> {
    let env: SessionEnvelope;
    try {
      env = JSON.parse(
        (payload.message.value ?? Buffer.alloc(0)).toString('utf8'),
      ) as SessionEnvelope;
    } catch (err) {
      this.logger.warn(`Dropping malformed session-lifecycle message: ${(err as Error).message}`);
      return;
    }
    if (!env.deviceId || !env.tenantId || !env.state) return; // pre-auth/unknown → ignore

    try {
      const at = env.time ? new Date(env.time) : new Date();
      const state = env.state.toUpperCase();
      const isConnect = state === 'AUTHENTICATED' || state === 'ACTIVE' || state === 'IDENTIFY';
      const isDisconnect = state === 'DISCONNECTED' || state === 'CLOSED';
      await this.devices.applyConnectionState(env.tenantId, env.deviceId, {
        lastSeenAt: at,
        connectedAt: isConnect ? at : null,
        disconnectedAt: isDisconnect ? at : null,
      });
    } catch (err) {
      // Unknown device / DB down → log + advance offset (at-least-once; idempotent timestamps).
      this.logger.warn(
        `Connection-state projection failed for device ${env.deviceId}: ${(err as Error).message}`,
      );
    }
  }
}
