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
import { DeviceMessage } from '../domain/device-message.js';
import type { DeviceSession } from '../domain/device-session.js';
import { ProtocolError } from '../domain/errors.js';
import type { RawPacket } from '../domain/raw-packet.js';
import type { DeviceGatewayKafkaProducer } from '../infrastructure/kafka/kafka-producer.js';
import type { ProtocolAdapter } from '../infrastructure/protocol/protocol-adapter.js';
import type { RawPacketStorage } from '../infrastructure/storage/raw-packet-storage.js';
import type { AuthResolver } from './auth-resolver.js';
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
}

export class PacketDispatcher {
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
        return { published: 0, authenticated: false, close: false, closeReason: null };
      }
      throw err;
    }

    let authenticated = false;
    let published = 0;

    for (const msg of messages) {
      // Stage 3: auth/resolve on LOGIN (06 §7). Fail-closed: unknown/disabled → close.
      if (msg.type === 'LOGIN') {
        const outcome = await this.deps.authResolver.resolve(msg.serialOrImei);
        if (!outcome.ok) {
          // INVARIANT #1: never publish pre-auth — and here we cannot even auth.
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
            now: raw.receivedAt,
          });
          await this.deps.sessionManager.registerAuthenticated(session);
        }
        authenticated = true;
        // LOGIN itself is published (telemetry.device.raw — 06 §11.5) now that we
        // are AUTHENTICATED. Re-stamp the identity onto the message.
        await this.publish(this.bindIdentity(msg, session), session, raw);
        published++;
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
        const outcome = await this.deps.authResolver.resolve(msg.serialOrImei);
        if (!outcome.ok) {
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
          now: raw.receivedAt,
        });
        await this.deps.sessionManager.registerAuthenticated(session);
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
      } else if (
        session.state === 'ACTIVE' &&
        (normalized.type === 'POSITION' || normalized.type === 'TELEMETRY')
      ) {
        session.recordData(raw.receivedAt);
        await this.deps.sessionManager.touch(session);
      }

      // Stage 5: publish (06 §8). Fail-closed invariant enforced by canPublish().
      await this.publish(normalized, session, raw);
      published++;
    }

    return { published, authenticated, close: false, closeReason: null };
  }

  /** Bind the session's resolved identity onto a pre-auth message (06 §9.2). */
  private bindIdentity(msg: DeviceMessage, session: DeviceSession): DeviceMessage {
    return new DeviceMessage({
      messageId: msg.messageId,
      deviceId: session.deviceId ?? msg.deviceId,
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
  }
}
