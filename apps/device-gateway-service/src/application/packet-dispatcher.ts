/**
 * PacketDispatcher — the staged packet-processing pipeline (06 §8).
 *
 *   RawPacket → 1. Decode → 2. Validate → 3. Auth/Resolve → 4. Normalize → 5. Publish
 *
 * Decoupling decode/normalize/publish from the read loop keeps the hot path
 * responsive — one slow Kafka produce must not stall reads (06 §8). Back-pressure
 * propagates through bounded stage queues (06 §8.2).
 *
 * The two fail-closed invariants enforced here (06 §6.1):
 *   #1 — a DeviceMessage is NEVER published before the session is AUTHENTICATED;
 *   #3 — a LOGIN triggers auth/resolve; on success the session authenticates and
 *        its deviceId/tenantId are bound to every subsequent message.
 *
 * Idempotency: messageId (UUIDv7) is the dedupe key (06 §8.4); consumers dedupe
 * on (device_id, message_id).
 */
import { Logger } from '@nestjs/common';
import { DeviceMessage } from '../domain/device-message.js';
import type { DeviceSession } from '../domain/device-session.js';
import { ProtocolError } from '../domain/errors.js';
import type { RawPacket } from '../domain/raw-packet.js';
import {
  formatCceFrameLog,
  formatCceRecordLog,
  isCceSnapshot,
} from '../infrastructure/adapters/meitrack/meitrack.cce-snapshot.js';
import { buildCceCacheAck } from '../infrastructure/adapters/meitrack/meitrack.decode.js';
import { PhotoAssembler } from '../infrastructure/adapters/meitrack/meitrack.photo-assembler.js';
import type { DeviceGatewayKafkaProducer } from '../infrastructure/kafka/kafka-producer.js';
import type { ProtocolAdapter } from '../infrastructure/protocol/protocol-adapter.js';
import type { CanSnapshotStore } from '../infrastructure/storage/can-snapshot-store.js';
import type { RawPacketStorage } from '../infrastructure/storage/raw-packet-storage.js';
import type { AuthResolver } from './auth-resolver.js';
import type { CommandDispatcher } from './command-dispatcher.js';
import type { SessionManager } from './session-manager.js';

export interface DispatchResult {
  /** Number of messages published to Kafka this dispatch. */
  readonly published: number;
  /** True if this dispatch authenticated the session (LOGIN success). */
  readonly authenticated: boolean;
  /** True if the session should be closed (auth failure / fatal proto error). */
  readonly close: boolean;
  /** Close reason when `close` is true. */
  readonly closeReason: 'AUTH_FAILED' | 'PROTOCOL_ERROR' | null;
}

export interface PacketDispatcherDeps {
  readonly authResolver: AuthResolver;
  readonly sessionManager: SessionManager;
  readonly kafka: DeviceGatewayKafkaProducer | null;
  readonly rawStorage: RawPacketStorage;
  /** Optional — flush held AB2 once the MDVR GPRS session authenticates. */
  readonly commandDispatcher?: CommandDispatcher;
  /** Optional — keeps CAN from CCE records that are not positions (no GPS fix). */
  readonly canStore?: CanSnapshotStore;
}

export class PacketDispatcher {
  private readonly logger = new Logger(PacketDispatcher.name);
  /** One assembler per process — keyed by IMEI+filename so two MDVRs can overlap. */
  private readonly photos = new PhotoAssembler();

  constructor(private readonly deps: PacketDispatcherDeps) {}

  /**
   * Process one framed RawPacket against its session through the pipeline.
   * Runs inline on the event loop for Sprint 3 (heavy decoders move to
   * worker_threads in a later sprint per 06 §3.4).
   */
  public async dispatch(
    session: DeviceSession,
    adapter: ProtocolAdapter,
    raw: RawPacket,
  ): Promise<DispatchResult> {
    // Stage 1+2: decode + validate (the adapter combines framing validation with
    // decode; the dispatcher catches ProtocolError → drop + metric).
    let messages: readonly DeviceMessage[];
    try {
      messages = adapter.decode(raw);
    } catch (err) {
      if (err instanceof ProtocolError) {
        const preview = raw.payload.subarray(0, 80);
        this.logger.warn(
          `Decode error session=${session.id} bytes=${raw.payload.length} ` +
            `ascii=${JSON.stringify(preview.toString('latin1'))}: ${err.message}`,
        );
        return { published: 0, authenticated: false, close: false, closeReason: null };
      }
      throw err;
    }

    let authenticated = false;
    let published = 0;
    // A packet can decode to several messages (CCE cache dumps, event + position).
    // One failed Kafka publish must not discard the siblings behind it, so
    // failures are collected and raised once the whole packet has been tried.
    const failures: Error[] = [];
    const publishOne = async (m: DeviceMessage): Promise<void> => {
      try {
        await this.publish(m, session, raw);
        published++;
      } catch (err) {
        failures.push(err as Error);
        this.logger.warn(
          `Publish failed session=${session.id} type=${m.type} message=${m.messageId}: ${(err as Error).message}`,
        );
      }
    };

    const frameLog = formatCceFrameLog(raw.payload);
    if (frameLog) this.logger.log(frameLog);

    for (const msg of messages) {
      // Stage 3: auth/resolve on LOGIN (06 §7). Fail-closed: unknown/disabled → close.
      if (msg.type === 'LOGIN') {
        const outcome = await this.deps.authResolver.resolve(msg.serialOrImei, adapter.id);
        if (!outcome.ok) {
          // INVARIANT #1: never publish pre-auth — and here we cannot even auth.
          this.logger.warn(
            `Auth failed for imei=${msg.serialOrImei} reason=${outcome.reason} — closing session.`,
          );
          return {
            published: 0,
            authenticated: false,
            close: true,
            closeReason: 'AUTH_FAILED',
          };
        }
        if (session.state === 'IDENTIFY' || session.state === 'NEW') {
          if (session.state === 'NEW') session.identify(raw.receivedAt);
          session.authenticate({
            deviceId: outcome.device.deviceId,
            tenantId: outcome.device.tenantId,
            serialOrImei: msg.serialOrImei,
            // Registry-sourced trusted vehicle identity (Sprint D §5).
            vehicleId: outcome.device.pairedVehicleId,
            now: raw.receivedAt,
          });
          await this.deps.sessionManager.registerAuthenticated(session);
          this.logger.log(
            `GPRS AUTHENTICATED imei=${msg.serialOrImei} device=${outcome.device.deviceId} ` +
              `session=${session.id} from ${session.remoteAddress}:${session.remotePort}`,
          );
        }
        authenticated = true;
        // LOGIN itself is published (telemetry.device.raw — 06 §11.5) now that we
        // are AUTHENTICATED. Re-stamp the identity onto the message.
        await publishOne(this.bindIdentity(msg, session));
        continue;
      }

      // Non-LOGIN messages require an already-authenticated session (06 §6.1 #1).
      if (!session.canPublish()) {
        // Implicit login (06 §7): some protocols carry the device identity in
        // every packet and never send a dedicated LOGIN (e.g. Meitrack embeds
        // the IMEI in each frame). For a pre-auth message that already carries a
        // serialOrImei, resolve + authenticate here, then fall through to publish
        // the real payload — exactly as a LOGIN would. This mirrors the reference
        // model where the first packet establishes the session. It is strictly
        // gated: messages with no serialOrImei (GT06 non-LOGIN frames) keep the
        // original anonymous pre-auth drop behavior, so existing adapters are
        // unaffected.
        if (!msg.serialOrImei) {
          continue; // anonymous pre-auth frame → drop silently; auth-grace closes later.
        }
        const outcome = await this.deps.authResolver.resolve(msg.serialOrImei, adapter.id);
        if (!outcome.ok) {
          this.logger.warn(
            `Auth failed for imei=${msg.serialOrImei} reason=${outcome.reason} — closing session.`,
          );
          return {
            published: 0,
            authenticated: false,
            close: true,
            closeReason: 'AUTH_FAILED',
          };
        }
        if (session.state === 'NEW') session.identify(raw.receivedAt);
        session.authenticate({
          deviceId: outcome.device.deviceId,
          tenantId: outcome.device.tenantId,
          serialOrImei: msg.serialOrImei,
          // Registry-sourced trusted vehicle identity (Sprint D §5).
          vehicleId: outcome.device.pairedVehicleId,
          now: raw.receivedAt,
        });
        await this.deps.sessionManager.registerAuthenticated(session);
        this.logger.log(
          `GPRS AUTHENTICATED imei=${msg.serialOrImei} device=${outcome.device.deviceId} ` +
            `session=${session.id} from ${session.remoteAddress}:${session.remotePort}`,
        );
        authenticated = true;
        // Fall through: publish the (now identity-bound) real payload.
      }

      // Stage 4: normalize — identity is already bound; stamp it onto the message.
      const normalized = this.bindIdentity(msg, session);

      // First useful payload (POSITION/TELEMETRY) transitions → ACTIVE (06 §6.1).
      if (
        session.state === 'AUTHENTICATED' &&
        (normalized.type === 'POSITION' || normalized.type === 'TELEMETRY')
      ) {
        session.activate(raw.receivedAt);
        await this.deps.sessionManager.markActive(session);
      } else if (session.canPublish()) {
        // Command ACKs (AB2/AB3) and alarms also prove the socket is live —
        // MDVR often sends those for minutes with no GPS. Refresh last_seen
        // so the map stays ONLINE instead of sweeping to STALE.
        if (
          session.state === 'ACTIVE' &&
          (normalized.type === 'POSITION' || normalized.type === 'TELEMETRY')
        ) {
          session.recordData(raw.receivedAt);
        }
        await this.deps.sessionManager.touch(session);
      }

      const cce = normalized.telemetry?.cce;
      if (isCceSnapshot(cce)) {
        this.logger.log(formatCceRecordLog(normalized.serialOrImei, normalized.type, cce));
        // A POSITION carries its CAN through gps-engine; anything else (no GPS
        // fix, heartbeat, driver alarm without a fix) would lose it here.
        if (
          normalized.type !== 'POSITION' &&
          cce.can.present &&
          session.tenantId &&
          session.vehicleId
        ) {
          await this.deps.canStore?.remember(
            session.tenantId,
            session.vehicleId,
            normalized.timestamp,
            cce.can as unknown as Record<string, unknown>,
          );
        }
      }

      // Stage 5: publish (06 §8). Fail-closed invariant enforced by canPublish().
      await publishOne(normalized);
    }

    // Drain AB2/AB3 held while the socket was down. Not only on the login
    // packet: a command that arrives just after AUTHENTICATED must still go
    // out on the next frame, otherwise it sits QUEUED until the unit redials.
    if (session.deviceId && session.canDispatchCommand()) {
      await this.deps.commandDispatcher?.flushHeld(session.deviceId);
    }

    // Surface the failure to the caller. The CCE cache ack below is skipped on
    // purpose: an un-acked MDVR keeps the records and resends them.
    if (failures.length > 0) {
      throw new Error(
        `${failures.length} of ${failures.length + published} message(s) not published: ${failures[0]?.message}`,
      );
    }

    if (adapter.id === 'meitrack' && session.canPublish()) {
      this.acknowledgeCceCache(session, raw);
    }

    return { published, authenticated, close: false, closeReason: null };
  }

  /**
   * Delete the MDVR records we just stored. Without this the device repeats the
   * buffer head (usually a track) and never reaches a queued driver alarm.
   */
  private acknowledgeCceCache(session: DeviceSession, raw: RawPacket): void {
    let ack: Buffer | null;
    try {
      ack = buildCceCacheAck(raw.payload);
    } catch (err) {
      this.logger.warn(
        `CFF cache ack build failed session=${session.id}: ${(err as Error).message}`,
      );
      return;
    }
    if (!ack || ack.length === 0) return;
    const writer = this.deps.sessionManager.writerFor(session.id as string);
    if (!writer) return;
    const ok = writer(ack);
    if (!ok) {
      this.logger.warn(`CFF cache ack write failed session=${session.id}`);
      return;
    }
    this.logger.log(`CFF cache ack session=${session.id} bytes=${ack.length}`);
  }

  /** Bind the session's resolved identity onto a pre-auth message (06 §9.2). */
  private bindIdentity(msg: DeviceMessage, session: DeviceSession): DeviceMessage {
    return new DeviceMessage({
      messageId: msg.messageId,
      deviceId: session.deviceId ?? msg.deviceId,
      // Registry-sourced trusted identity (Sprint D §5) + per-session
      // correlation id for end-to-end tracing.
      vehicleId: session.vehicleId ?? msg.vehicleId ?? null,
      correlationId: (session.id as string) ?? msg.correlationId ?? null,
      serialOrImei: msg.serialOrImei || session.serialOrImei || '',
      tenantId: session.tenantId ?? msg.tenantId,
      protocolId: msg.protocolId,
      type: msg.type,
      timestamp: msg.timestamp,
      ingestedAt: msg.ingestedAt,
      position: msg.position,
      alarms: msg.alarms,
      telemetry: msg.telemetry,
      io: msg.io,
      rawSize: msg.rawSize,
      checksum: msg.checksum,
      direction: msg.direction,
    });
  }

  /**
   * Publish a normalized message to Kafka, with the fail-closed assertion and a
   * best-effort raw-retention side-step (06 §10.3, §13.4). Kafka failure
   * propagates so the caller applies back-pressure (06 §8.2).
   */
  private async publish(msg: DeviceMessage, session: DeviceSession, raw: RawPacket): Promise<void> {
    session.assertCanPublish(); // invariant #1 — throws if violated (fail-closed)
    // Best-effort forensic retention (never blocks publish — 06 §13.4).
    void this.deps.rawStorage.retain(raw, msg.deviceId, msg.messageId);
    if (!this.deps.kafka) return;
    await this.deps.kafka.publish(msg);
    const photoAck = this.assemblePhotoAck(msg);
    if (photoAck) {
      try {
        await this.deps.kafka.publish(photoAck);
      } catch (err) {
        // Never let a too-large photo drop the device's connection.
        this.logger.warn(`D00 photo ack publish failed: ${(err as Error).message}`);
      }
    }
  }

  /**
   * D00 arrives as PHOTO chunks. When a filename is complete, emit COMMAND_ACK
   * so fleet-management can ACK the pending D00 row with the JPEG (base64).
   */
  private assemblePhotoAck(msg: DeviceMessage): DeviceMessage | null {
    if (msg.type !== 'PHOTO') return null;
    const filename = typeof msg.telemetry?.filename === 'string' ? msg.telemetry.filename : '';
    const chunkBase64 =
      typeof msg.telemetry?.chunkBase64 === 'string' ? msg.telemetry.chunkBase64 : '';
    if (!filename || !chunkBase64) {
      this.logger.warn(`D00 chunk without data dropped (${filename || 'no filename'})`);
      return null;
    }
    const totalPackets = Number(msg.telemetry?.totalPackets ?? 0);
    const packetIndex = Number(msg.telemetry?.packetIndex ?? 0);
    if (packetIndex <= 1) {
      this.logger.log(`D00 photo ${filename}: chunk ${packetIndex}/${totalPackets} received`);
    }
    const result = this.photos.feed({
      filename: `${msg.serialOrImei}::${filename}`,
      totalPackets,
      packetIndex,
      chunkBase64,
    });
    if (result.status !== 'complete') return null;
    const logical = result.filename.includes('::')
      ? result.filename.slice(result.filename.indexOf('::') + 2)
      : result.filename;
    this.logger.log(`D00 photo complete ${logical} (${result.data.length} bytes)`);
    return new DeviceMessage({
      messageId: globalThis.crypto.randomUUID(),
      deviceId: msg.deviceId,
      vehicleId: msg.vehicleId ?? null,
      correlationId: msg.correlationId ?? null,
      serialOrImei: msg.serialOrImei,
      tenantId: msg.tenantId,
      protocolId: msg.protocolId,
      type: 'COMMAND_ACK',
      timestamp: msg.timestamp,
      ingestedAt: msg.ingestedAt,
      telemetry: {
        command: 'D00',
        filename: logical,
        photoBase64: result.data.toString('base64'),
        byteLength: result.data.length,
        response: 'OK',
      },
      rawSize: result.data.length,
      checksum: msg.checksum,
      direction: msg.direction,
    });
  }
}
