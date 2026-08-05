/**
 * DeviceSession — the ingestion-tier session aggregate root (06 §6, §11.1).
 *
 * A session is the live association between a resolved device identity and its
 * transport endpoint (TCP socket or UDP pseudo-source). It is the unit of
 * command dispatch and liveness monitoring. Sessions are Redis-only, ephemeral
 * (06 §16.2) — never persisted to PostgreSQL as business state.
 *
 * Lifecycle state machine (06 §6.1):
 *   [*] → NEW (TCP accept / first UDP datagram)
 *   NEW → IDENTIFY (first valid frame)
 *   NEW → CLOSING (timeout / proto error)
 *   IDENTIFY → AUTHENTICATED (device resolved + auth ok)
 *   IDENTIFY → CLOSING (unknown / disabled device)
 *   AUTHENTICATED → ACTIVE (first POSITION/TELEMETRY)
 *   ACTIVE → ACTIVE (any inbound frame — Touch)
 *   ACTIVE → DISCONNECTED (idle timeout / EOF (TCP) / TTL expire (UDP))
 *   AUTHENTICATED → CLOSING (duplicate session elsewhere)
 *   DISCONNECTED → CLOSED
 *   CLOSING → CLOSED
 *
 * Invariants enforced here:
 *   1. A DeviceMessage is never published before AUTHENTICATED — fail-closed
 *      (cannot tag a valid tenant_id otherwise). Enforced by `canPublish()`.
 *   2. A downstream command is never written to a socket in NEW/IDENTIFY/CLOSING.
 *      Enforced by `canDispatchCommand()`.
 *   3. SessionId is stable for the connection's life; reconnect yields a new id
 *      (the caller creates a new aggregate — this one never rekeys).
 */
import { AggregateRoot, type Brand } from '@fleetvision/shared-kernel';
import { IllegalSessionTransitionError, SessionInvariantError } from './errors.js';
import { type SessionId, newSessionId } from './session-id.js';

export type SessionState =
  | 'NEW'
  | 'IDENTIFY'
  | 'AUTHENTICATED'
  | 'ACTIVE'
  | 'DISCONNECTED'
  | 'CLOSING'
  | 'CLOSED';

export type Transport = 'tcp' | 'udp';

/** Reason a session transitioned out of the live states (06 §6.1, §12.4). */
export type CloseReason =
  | 'IDLE_TIMEOUT'
  | 'PROTOCOL_ERROR'
  | 'AUTH_FAILED'
  | 'DUPLICATE_SESSION'
  | 'REMOTE_DISCONNECT'
  | 'TTL_EXPIRED'
  | 'ADMIN'
  | 'SHUTDOWN';

export interface DeviceSessionProps {
  readonly transport: Transport;
  /** Adapter id, e.g. 'gt06'. */
  readonly protocolId: string;
  /** Remote endpoint — TCP peer or UDP source. */
  readonly remoteAddress: string;
  readonly remotePort: number;
  /** Owning pod instance id (for cross-instance lookup, 06 §6.2). */
  readonly instanceId: string;
  readonly createdAt: Date;
  /** Mutable state below. */
  state: SessionState;
  lastSeenAt: Date;
  /** Resolved once authenticated; null before. */
  deviceId: string | null;
  tenantId: string | null;
  serialOrImei: string | null;
  /** First useful payload (POSITION/TELEMETRY) time — drives ACTIVE transition. */
  firstDataAt: Date | null;
  /** Last useful payload time — drives data-liveness / STALE_DATA (06 §12.1). */
  lastDataAt: Date | null;
  closeReason: CloseReason | null;
}

export class DeviceSession extends AggregateRoot<SessionId> {
  private readonly props: DeviceSessionProps;

  private constructor(id: SessionId, props: DeviceSessionProps) {
    super(id);
    this.props = props;
  }

  /** Open a new session (NEW) on accept / first datagram. */
  public static open(init: {
    transport: Transport;
    protocolId: string;
    remoteAddress: string;
    remotePort: number;
    instanceId: string;
    now?: Date;
  }): DeviceSession {
    const now = init.now ?? new Date();
    return new DeviceSession(newSessionId(now.getTime()), {
      transport: init.transport,
      protocolId: init.protocolId,
      remoteAddress: init.remoteAddress,
      remotePort: init.remotePort,
      instanceId: init.instanceId,
      createdAt: now,
      state: 'NEW',
      lastSeenAt: now,
      deviceId: null,
      tenantId: null,
      serialOrImei: null,
      firstDataAt: null,
      lastDataAt: null,
      closeReason: null,
    });
  }

  /** Rehydrate from Redis (no events raised). */
  public static rehydrate(id: string, props: DeviceSessionProps): DeviceSession {
    return new DeviceSession(id as Brand<string, 'SessionId'>, props);
  }

  // --- Read accessors -------------------------------------------------------

  public get transport(): Transport {
    return this.props.transport;
  }
  public get protocolId(): string {
    return this.props.protocolId;
  }
  public get remoteAddress(): string {
    return this.props.remoteAddress;
  }
  public get remotePort(): number {
    return this.props.remotePort;
  }
  public get instanceId(): string {
    return this.props.instanceId;
  }
  public get createdAt(): Date {
    return this.props.createdAt;
  }
  public get state(): SessionState {
    return this.props.state;
  }
  public get lastSeenAt(): Date {
    return this.props.lastSeenAt;
  }
  public get deviceId(): string | null {
    return this.props.deviceId;
  }
  public get tenantId(): string | null {
    return this.props.tenantId;
  }
  public get serialOrImei(): string | null {
    return this.props.serialOrImei;
  }
  public get firstDataAt(): Date | null {
    return this.props.firstDataAt;
  }
  public get lastDataAt(): Date | null {
    return this.props.lastDataAt;
  }
  public get closeReason(): CloseReason | null {
    return this.props.closeReason;
  }

  /** A session is "live" iff it can still receive frames. */
  public get isLive(): boolean {
    return (
      this.props.state === 'NEW' ||
      this.props.state === 'IDENTIFY' ||
      this.props.state === 'AUTHENTICATED' ||
      this.props.state === 'ACTIVE'
    );
  }

  // --- State transitions (06 §6.1) -----------------------------------------

  /** First valid frame received — NEW → IDENTIFY. */
  public identify(now: Date = new Date()): void {
    this.requireFrom(['NEW'], 'IDENTIFY');
    this.props.state = 'IDENTIFY';
    this.touch(now);
  }

  /**
   * Device resolved and auth ok — IDENTIFY → AUTHENTICATED.
   * The resolved identity is bound here; it is immutable for the session's life.
   */
  public authenticate(resolved: {
    deviceId: string;
    tenantId: string;
    serialOrImei: string;
    now?: Date;
  }): void {
    this.requireFrom(['IDENTIFY'], 'AUTHENTICATED');
    this.props.deviceId = resolved.deviceId;
    this.props.tenantId = resolved.tenantId;
    this.props.serialOrImei = resolved.serialOrImei;
    this.props.state = 'AUTHENTICATED';
    this.touch(resolved.now ?? new Date());
  }

  /** First useful payload (POSITION/TELEMETRY) — AUTHENTICATED → ACTIVE. */
  public activate(now: Date = new Date()): void {
    if (this.props.state === 'ACTIVE') {
      this.recordData(now);
      return;
    }
    this.requireFrom(['AUTHENTICATED'], 'ACTIVE');
    this.props.state = 'ACTIVE';
    this.props.firstDataAt = now;
    this.props.lastDataAt = now;
    this.touch(now);
  }

  /**
   * Record a useful payload (POSITION/TELEMETRY) on an already-ACTIVE session —
   * refreshes data liveness (06 §12.1). No-op unless ACTIVE; activation happens
   * via `activate()` on the first useful payload.
   */
  public recordData(now: Date = new Date()): void {
    if (this.props.state !== 'ACTIVE') return;
    this.props.lastDataAt = now;
    this.touch(now);
  }

  /** Mark a frame seen — refreshes liveness without a state change. */
  public touch(now: Date = new Date()): void {
    this.props.lastSeenAt = now;
  }

  /** Begin teardown — any live/authenticated state → CLOSING. */
  public beginClosing(reason: CloseReason, now: Date = new Date()): void {
    if (this.props.state === 'CLOSED' || this.props.state === 'DISCONNECTED') {
      // Already terminal/teardown; record the latest reason and return.
      this.props.closeReason = reason;
      return;
    }
    this.props.state = 'CLOSING';
    this.props.closeReason = reason;
    this.touch(now);
  }

  /** Socket EOF / TTL expire — ACTIVE/AUTHENTICATED → DISCONNECTED. */
  public disconnect(reason: CloseReason, now: Date = new Date()): void {
    if (this.props.state === 'CLOSED') {
      return;
    }
    if (this.props.state !== 'ACTIVE' && this.props.state !== 'AUTHENTICATED') {
      // Non-authenticated teardowns go through CLOSING first (06 §6.1).
      this.beginClosing(reason, now);
    }
    this.props.state = 'DISCONNECTED';
    this.props.closeReason = reason;
    this.touch(now);
  }

  /** Finalize — DISCONNECTED/CLOSING → CLOSED. */
  public close(now: Date = new Date()): void {
    if (this.props.state === 'CLOSED') return;
    this.props.state = 'CLOSED';
    this.touch(now);
  }

  // --- Invariant gates (06 §6.1) -------------------------------------------

  /** Invariant #1: messages publish only once AUTHENTICATED. */
  public canPublish(): boolean {
    return this.props.state === 'AUTHENTICATED' || this.props.state === 'ACTIVE';
  }

  /** Assert the publish invariant, throwing fail-closed if violated. */
  public assertCanPublish(): void {
    if (!this.canPublish()) {
      throw new SessionInvariantError(
        `Cannot publish for session ${this.id} in state ${this.props.state} — not authenticated (06 §6.1 invariant #1).`,
      );
    }
  }

  /** Invariant #2: downstream commands only to authenticated+active sessions. */
  public canDispatchCommand(): boolean {
    return this.props.state === 'AUTHENTICATED' || this.props.state === 'ACTIVE';
  }

  /** Snapshot for Redis persistence / admin API (06 §6.2, §16.1). */
  public toSnapshot(): DeviceSessionSnapshot {
    return {
      sessionId: this.id as string,
      instanceId: this.props.instanceId,
      protocolId: this.props.protocolId,
      transport: this.props.transport,
      state: this.props.state,
      deviceId: this.props.deviceId,
      tenantId: this.props.tenantId,
      serialOrImei: this.props.serialOrImei,
      remoteAddress: this.props.remoteAddress,
      remotePort: this.props.remotePort,
      since: this.props.createdAt.toISOString(),
      lastSeen: this.props.lastSeenAt.toISOString(),
      firstDataAt: this.props.firstDataAt?.toISOString() ?? null,
      lastDataAt: this.props.lastDataAt?.toISOString() ?? null,
      closeReason: this.props.closeReason,
    };
  }

  private requireFrom(from: SessionState[], to: SessionState): void {
    if (!from.includes(this.props.state)) {
      throw new IllegalSessionTransitionError(
        `Cannot transition session from ${this.props.state} to ${to} (06 §6.1).`,
      );
    }
  }
}

/** Persistable/admin view of a session (Redis value, 06 §16.1). */
export interface DeviceSessionSnapshot {
  readonly sessionId: string;
  readonly instanceId: string;
  readonly protocolId: string;
  readonly transport: Transport;
  readonly state: SessionState;
  readonly deviceId: string | null;
  readonly tenantId: string | null;
  readonly serialOrImei: string | null;
  readonly remoteAddress: string;
  readonly remotePort: number;
  readonly since: string;
  readonly lastSeen: string;
  readonly firstDataAt: string | null;
  readonly lastDataAt: string | null;
  readonly closeReason: CloseReason | null;
}
