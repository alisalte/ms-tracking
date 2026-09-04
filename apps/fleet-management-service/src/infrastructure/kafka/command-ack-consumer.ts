/**
 * CommandAckConsumer — projects device-command feedback events from the
 * `fleetvision.telemetry.command.ack` topic onto `fleet.device_commands`:
 *
 *   telemetry.command.sent.v1     (gateway)  → QUEUED → SENT
 *   telemetry.command.rejected.v1 (gateway)  → QUEUED → FAILED (+ reason)
 *   telemetry.command.ack.v1      (device)   → SENT → ACKED / FAILED
 *
 * Ack correlation: the Meitrack D82 reply carries only the command code (§1.1
 * — `$$..,D82,A11,OK`), no command id, so the consumer matches the LATEST
 * non-terminal row for (tenant, device, code). Explicit device errors
 * (`Error`, `FFF5`, …) → FAILED; OK and value-bearing readbacks (`A11,10`) → ACKED.
 *
 * Non-fatal at boot (mirrors SessionLifecycleConsumer): at-least-once,
 * idempotent via the repository's status guards.
 */
import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { type Consumer, type EachMessagePayload, Kafka } from 'kafkajs';
import type { FleetManagementConfig } from '../../config/fleet-management.config.js';
import type { DeviceCommandRepository } from '../persistence/device-command.repository.js';

/** One of the three event envelopes that share the command topic. */
interface CommandEventEnvelope {
  readonly type?: string;
  readonly commandId?: string | null;
  readonly deviceId?: string | null;
  readonly tenantId?: string | null;
  readonly commandCode?: string | null;
  readonly result?: string | null;
  readonly reason?: string | null;
  // COMMAND_ACK (device) message envelope (06 §13.2 toEnvelope):
  readonly telemetry?: {
    readonly command?: string;
    readonly response?: string;
    readonly resources?: unknown;
    readonly photoNames?: unknown;
    readonly allPack?: number;
    readonly curPack?: number;
    readonly allFileNum?: number;
  } | null;
}

/** True when the device payload is an explicit failure, not a value-bearing readback. */
export function isDeviceErrorResponse(payload: string): boolean {
  const p = payload.trim();
  if (!p) return false;
  if (/^(ok)(\b|,|$)/i.test(p)) return false;
  if (/^(error|fail|failed|err)(\b|,|$)/i.test(p)) return true;
  if (/^fff[0-9a-f]{1,2}$/i.test(p)) return true;
  if (/^not support/i.test(p)) return true;
  return false;
}

export class CommandAckConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('CommandAckConsumer');
  private consumer: Consumer | null = null;
  private started = false;

  constructor(
    private readonly config: FleetManagementConfig,
    private readonly commands: DeviceCommandRepository,
  ) {}

  public async onApplicationBootstrap(): Promise<void> {
    try {
      await this.start();
    } catch (err) {
      this.logger.warn(`Command-ack consumer not started: ${(err as Error).message}`);
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    if (!this.started) return;
    await this.consumer?.disconnect().catch(() => {
      /* best-effort */
    });
    this.consumer = null;
    this.started = false;
  }

  public async start(): Promise<void> {
    if (this.started) return;
    const kafka = new Kafka({
      brokers: this.config.FLEET_KAFKA_BROKERS.split(','),
      clientId: this.config.FLEET_KAFKA_CLIENT_ID,
    });
    this.consumer = kafka.consumer({
      groupId: `${this.config.FLEET_KAFKA_GROUP_ID}-cmd-ack`,
      sessionTimeout: 30_000,
      heartbeatInterval: 10_000,
    });
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: this.config.FLEET_KAFKA_COMMAND_ACK_TOPIC,
      fromBeginning: false,
    });
    this.started = true;
    this.logger.log(`Subscribed to ${this.config.FLEET_KAFKA_COMMAND_ACK_TOPIC}.`);
    await this.consumer.run({ eachMessage: (p) => this.eachMessage(p) });
  }

  private async eachMessage(payload: EachMessagePayload): Promise<void> {
    let env: CommandEventEnvelope;
    try {
      env = JSON.parse(
        (payload.message.value ?? Buffer.alloc(0)).toString('utf8'),
      ) as CommandEventEnvelope;
    } catch {
      this.logger.warn('Dropping malformed command-ack message (invalid JSON).');
      return;
    }
    try {
      const type = env.type ?? String(payload.message.headers?.['event-type'] ?? '');
      switch (type) {
        case 'telemetry.command.sent.v1':
          await this.handleSent(env);
          break;
        case 'telemetry.command.rejected.v1':
          await this.handleRejected(env);
          break;
        case 'telemetry.command.ack.v1':
          await this.handleDeviceAck(env);
          break;
        default:
          // Other producers on the topic family (legacy) — ignore.
          break;
      }
    } catch (err) {
      // Log + advance — repository status guards make retries idempotent.
      this.logger.warn(`Command-ack projection failed: ${(err as Error).message}`);
    }
  }

  private async handleSent(env: CommandEventEnvelope): Promise<void> {
    if (!env.tenantId || !env.commandId) return;
    await this.commands.markSent(env.tenantId, env.commandId);
  }

  private async handleRejected(env: CommandEventEnvelope): Promise<void> {
    if (!env.tenantId || !env.commandId) return;
    await this.commands.markFailed(env.tenantId, env.commandId, env.reason ?? 'REJECTED');
  }

  private async handleDeviceAck(env: CommandEventEnvelope): Promise<void> {
    const tenantId = env.tenantId;
    const deviceId = env.deviceId;
    if (!tenantId || !deviceId) return;

    // Two reply shapes reach this path (both decoded as COMMAND_ACK upstream):
    //   1. MDVR echoed-code reply — telemetry.command = 'A11', response = 'OK'
    //      (MDVR GPRS Protocol V2.0 §3.x: $$…,A11,OK).
    //   2. D82 wrapper — telemetry.command = 'D82', response = 'A11,OK'.
    const tmCommand = env.telemetry?.command ?? '';
    const tmResponse = env.telemetry?.response ?? '';
    let code: string;
    let payload: string;
    if (env.commandCode) {
      code = env.commandCode;
      payload = tmResponse;
    } else if (tmCommand === 'D82' || tmCommand === 'AAC') {
      const [echoed, ...rest] = tmResponse.split(',');
      code = echoed ?? '';
      payload = rest.join(',');
    } else {
      code = tmCommand;
      payload = tmResponse;
    }
    if (!code) return;

    const pending = await this.commands.latestPendingByCode(tenantId, deviceId, code);
    if (!pending) return; // already terminal or unknown — nothing to do.

    const resources = env.telemetry?.resources;
    if (Array.isArray(resources)) {
      await this.commands.markAcked(
        tenantId,
        pending.id,
        JSON.stringify({
          resources,
          allPack: env.telemetry?.allPack ?? 1,
          curPack: env.telemetry?.curPack ?? 1,
          allFileNum: env.telemetry?.allFileNum ?? resources.length,
        }),
      );
      return;
    }
    const photoNames = env.telemetry?.photoNames;
    if (Array.isArray(photoNames)) {
      await this.commands.markAcked(tenantId, pending.id, JSON.stringify({ photoNames }));
      return;
    }

    if (/^ok/i.test(payload.trim()) || !isDeviceErrorResponse(payload)) {
      await this.commands.markAcked(tenantId, pending.id, `${code},${payload}`);
    } else {
      await this.commands.markFailed(
        tenantId,
        pending.id,
        `DEVICE_ERROR:${payload}`,
        `${code},${payload}`,
      );
    }
  }
}
