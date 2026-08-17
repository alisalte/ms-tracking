/**
 * CommandDispatcher — downstream device-command path (06 §6.2, §11.3 SendDeviceCommand).
 *
 * Takes a command request (already validated + persisted by the originating
 * service, arriving via the Kafka `command.request` consumer) and writes the
 * encoded frame to the socket backing the device's live session:
 *
 *   lookup session (local byDeviceId, O(1))
 *     → gate: canDispatchCommand() (06 §6.1 invariant #2 — never write to a
 *       NEW/IDENTIFY/CLOSING session)
 *     → adapter.encode(DeviceCommand)
 *     → SessionWriter (registered by the TCP listener's onOpen)
 *     → publish COMMAND_SENT feedback for the originating service.
 *
 * No local session → the command is either held by another gateway instance
 * (Redis snapshot carries a different instanceID — stay silent, that instance
 * also received the broadcast and owns the write) or the device is offline
 * (no snapshot at all → publish COMMAND_REJECTED DEVICE_OFFLINE).
 */
import { Logger } from '@nestjs/common';
import type { DeviceSession } from '../domain/index.js';
import type { DeviceGatewayKafkaProducer } from '../infrastructure/kafka/index.js';
import type { ProtocolAdapter } from '../infrastructure/protocol/index.js';
import type { AdapterRegistry } from '../infrastructure/protocol/index.js';
import type { SessionRedisStore } from '../infrastructure/storage/index.js';
import type { SessionManager } from './session-manager.js';

/** A downstream command request as published on `command.request`. */
export interface DeviceCommandRequest {
  /** Originating service's command record id (echoed in feedback events). */
  readonly commandId: string;
  readonly deviceId: string;
  readonly tenantId: string | null;
  readonly protocolId: string;
  /** Protocol command code, e.g. 'A11' (echoed in feedback events). */
  readonly commandCode: string;
  /**
   * Wire payload text after `<imei>,` — e.g. `A11,10`. For binary-bodied
   * commands (MDVR media structs) `payloadHex` carries the raw body instead.
   */
  readonly payloadText: string | null;
  /** Hex-encoded binary body (alternative to payloadText), e.g. `A9B,01010000`. */
  readonly payloadHex: string | null;
}

/** Outcome of one dispatch attempt. */
export type CommandDispatchResult =
  | { readonly outcome: 'SENT' }
  | { readonly outcome: 'REJECTED'; readonly reason: string }
  /** Another instance owns the session — it performs (or already performed) the write. */
  | { readonly outcome: 'ROUTED_ELSEWHERE' };

export class CommandDispatcher {
  private readonly logger = new Logger(CommandDispatcher.name);

  constructor(
    private readonly sessions: SessionManager,
    private readonly adapters: AdapterRegistry,
    private readonly kafka: DeviceGatewayKafkaProducer | null,
    private readonly redisStore: SessionRedisStore | null,
  ) {}

  /**
   * Attempt to write `request` to the device's live session. Publishes
   * SENT/REJECTED feedback (best-effort) for the originating service.
   */
  public async dispatch(request: DeviceCommandRequest): Promise<CommandDispatchResult> {
    const session = this.sessions.byDeviceId(request.deviceId);
    if (!session) {
      const result = await this.handleNoLocalSession(request);
      return result;
    }
    if (!session.canDispatchCommand()) {
      return this.reject(request, 'DEVICE_NOT_AUTHENTICATED');
    }

    const adapter = this.adapters.get(session.protocolId);
    if (!adapter) {
      return this.reject(request, `ADAPTER_NOT_FOUND:${session.protocolId}`);
    }

    const frame = this.encode(adapter, session, request);
    if (frame.length === 0) {
      return this.reject(request, 'ENCODE_FAILED');
    }

    const writer = this.sessions.writerFor(session.id as string);
    if (!writer) {
      return this.reject(request, 'NO_TRANSPORT_WRITER');
    }
    let written: boolean;
    try {
      written = writer(frame);
    } catch (err) {
      this.logger.warn(
        `Socket write failed for device ${request.deviceId}: ${(err as Error).message}`,
      );
      written = false;
    }
    if (!written) {
      return this.reject(request, 'SOCKET_WRITE_FAILED');
    }

    this.logger.debug(
      `Command ${request.commandCode} (${request.commandId}) written to device ` +
        `${request.deviceId} on session ${session.id}.`,
    );
    await this.publishFeedback(request, 'SENT', null);
    return { outcome: 'SENT' };
  }

  private encode(
    adapter: ProtocolAdapter,
    session: DeviceSession,
    request: DeviceCommandRequest,
  ): Buffer {
    try {
      const payload: Record<string, unknown> = {
        imei: session.serialOrImei,
        commandCode: request.commandCode,
      };
      if (request.payloadHex) {
        payload.hex = request.payloadHex;
      } else {
        payload.text = request.payloadText ?? '';
      }
      return adapter.encode({
        deviceId: request.deviceId,
        type: 'COMMAND',
        payload,
      });
    } catch (err) {
      this.logger.warn(
        `Encode failed for command ${request.commandCode} → device ${request.deviceId}: ` +
          `${(err as Error).message}`,
      );
      return Buffer.alloc(0);
    }
  }

  /**
   * No local session: distinguish "held by another instance" (silent — the
   * owner also consumes the broadcast) from "offline" (publish REJECTED).
   */
  private async handleNoLocalSession(
    request: DeviceCommandRequest,
  ): Promise<CommandDispatchResult> {
    if (request.tenantId && this.redisStore) {
      const snapshot = await this.redisStore
        .get(request.tenantId, request.deviceId)
        .catch(() => null);
      if (snapshot) {
        // Another gateway instance holds the live session — it dispatches.
        return { outcome: 'ROUTED_ELSEWHERE' };
      }
    }
    return this.reject(request, 'DEVICE_OFFLINE');
  }

  private async reject(
    request: DeviceCommandRequest,
    reason: string,
  ): Promise<CommandDispatchResult> {
    await this.publishFeedback(request, 'REJECTED', reason);
    return { outcome: 'REJECTED', reason };
  }

  private async publishFeedback(
    request: DeviceCommandRequest,
    result: 'SENT' | 'REJECTED',
    reason: string | null,
  ): Promise<void> {
    if (!this.kafka) return;
    try {
      await this.kafka.publishCommandEvent({
        commandId: request.commandId,
        deviceId: request.deviceId,
        tenantId: request.tenantId,
        protocolId: request.protocolId,
        commandCode: request.commandCode,
        result,
        reason,
      });
    } catch (err) {
      this.logger.warn(
        `Command feedback publish failed (${request.commandId}): ${(err as Error).message}`,
      );
    }
  }
}
