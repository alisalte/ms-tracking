/**
 * SessionManager — two-tier session store + lifecycle orchestration (06 §6).
 *
 *   Local (in-process): Map<DeviceId, Session> for O(1) command dispatch on the
 *                       owning instance (06 §6.2).
 *   Global (Redis):     tenant:<tid>:device:<did>:session → snapshot, TTL 60s
 *                       (TCP) / 2x interval (UDP). Cross-instance lookup for
 *                       "which pod holds this device?" (06 §6.2).
 *
 * Reconnection & affinity (06 §6.3, Sprint D §7/§8): a new connection from a
 * known DeviceID REPLACES the session — deterministic "newest wins":
 *   - same pod:   `registerAuthenticated` closes the prior local session with
 *                 DUPLICATE_SESSION and destroys its socket immediately.
 *   - cross-pod:  Redis last-write-wins; the prior pod detects its session
 *                 superseded during the periodic `sweep()` (the Redis snapshot
 *                 no longer carries its sessionID) and closes with
 *                 DUPLICATE_SESSION.
 * A device therefore never has two authoritative sessions for longer than one
 * sweep interval.
 *
 * The manager is the single writer for session lifecycle events: it persists the
 * global snapshot, raises session-lifecycle Kafka events (06 §11.5), and owns
 * the local index. The dispatcher calls here on each transition.
 */
import { Logger } from '@nestjs/common';
import type {
  CloseReason,
  DeviceSession,
  DeviceSessionSnapshot,
  Transport,
} from '../domain/index.js';
import type { SessionRedisStore } from '../infrastructure/storage/session-redis-store.js';

export interface SessionManagerOptions {
  /** TTL (seconds) for TCP global session entries (06 §16.1 — 60s). */
  readonly tcpTtlSeconds: number;
  /** TTL (seconds) for UDP pseudo-session entries (06 §4.4 — 2x interval). */
  readonly udpTtlSeconds: number;
  /** Grace period (ms) before an unauthenticated session is swept (Sprint D §7). */
  readonly authGraceMs?: number;
  /**
   * Minimum interval (ms) between superseded-checks per session in `sweep()`
   * (throttles the Redis read; the TCP TTL is 60s so checking every ~15s is
   * well within the detection window).
   */
  readonly supersededCheckIntervalMs?: number;
}

const DEFAULT_SESSION_OPTIONS = {
  authGraceMs: 15_000,
  supersededCheckIntervalMs: 15_000,
};

export interface SessionLifecycleEmitter {
  publishSessionLifecycle(event: {
    readonly sessionId: string;
    readonly deviceId: string | null;
    readonly tenantId: string | null;
    readonly state: string;
    readonly reason: string | null;
    readonly protocolId: string;
    readonly at: Date;
  }): Promise<void>;
}

/** Result of registering a freshly authenticated session globally. */
export interface RegisterResult {
  /** True if this session displaced another instance's session (06 §6.3 reconnect). */
  readonly displaced: boolean;
}

/** Outcome statistics of one liveness sweep (observability / tests). */
export interface SweepResult {
  closedAuthGrace: number;
  closedUdpTtl: number;
  closedSuperseded: number;
}

/** Transport teardown hook — destroys the socket backing a session. */
export type SessionTerminator = (reason: CloseReason) => void;

export class SessionManager {
  private readonly logger = new Logger(SessionManager.name);
  /** Local index by device id (post-auth) — O(1) dispatch (06 §6.2). */
  private readonly byDevice = new Map<string, DeviceSession>();
  /** Local index by session id. */
  private readonly bySession = new Map<string, DeviceSession>();
  /** UDP pseudo-session index by source endpoint (06 §4.4). */
  private readonly byUdpSource = new Map<string, DeviceSession>();
  /** Per-session transport terminators (socket destroy on manager-initiated close). */
  private readonly terminators = new Map<string, SessionTerminator>();
  /** Per-session established timestamp for last-write-wins comparison (06 §6.3). */
  private readonly establishedAt = new Map<string, number>();
  /** Last time each session was checked for cross-instance supersession. */
  private readonly supersededCheckedAt = new Map<string, number>();

  constructor(
    private readonly redisStore: SessionRedisStore | null,
    private readonly emitter: SessionLifecycleEmitter | null,
    private readonly instanceId: string,
    options: SessionManagerOptions,
  ) {
    this.options = { ...DEFAULT_SESSION_OPTIONS, ...options };
  }

  private readonly options: Required<SessionManagerOptions>;

  /** Track a session locally (on open — pre-auth, no global entry yet). */
  public track(session: DeviceSession): void {
    const id = session.id as string;
    this.bySession.set(id, session);
    this.establishedAt.set(id, session.createdAt.getTime());
    if (session.transport === 'udp') {
      this.byUdpSource.set(udpSourceKey(session.protocolId, session.remoteAddress, session.remotePort), session);
    }
  }

  /**
   * Find the live UDP pseudo-session for a source endpoint so a datagram
   * reuses it instead of leaking a fresh session per packet (06 §4.4).
   */
  public udpSessionFor(
    protocolId: string,
    remoteAddress: string,
    remotePort: number,
  ): DeviceSession | null {
    const existing = this.byUdpSource.get(udpSourceKey(protocolId, remoteAddress, remotePort));
    if (existing && existing.isLive) return existing;
    return null;
  }

  /**
   * Register a transport terminator so manager-initiated closes (duplicate
   * session, sweep, shutdown) also destroy the underlying socket.
   */
  public registerTerminator(sessionId: string, terminator: SessionTerminator): void {
    this.terminators.set(sessionId, terminator);
  }

  /**
   * Register a session globally once authenticated. Writes the Redis snapshot
   * (last-write-wins) and raises the AUTHENTICATED lifecycle event (06 §11.5).
   * Indexes locally by deviceId for O(1) dispatch.
   *
   * Sprint D §8 — deterministic duplicate handling: if a prior LIVE local
   * session exists for the same device, it is closed with DUPLICATE_SESSION
   * (newest connection wins; the old session's socket is destroyed).
   */
  public async registerAuthenticated(session: DeviceSession): Promise<RegisterResult> {
    if (session.deviceId) {
      await this.evictLocalDuplicate(session.deviceId, session);
      this.byDevice.set(session.deviceId, session);
    }
    let displaced = false;
    if (this.redisStore && session.tenantId && session.deviceId) {
      const result = await this.redisStore.upsertSnapshot(
        session.toSnapshot(),
        this.ttlFor(session.transport),
        this.instanceId,
      );
      displaced = result.displaced;
    }
    await this.emitLifecycle(session, 'AUTHENTICATED', null);
    return { displaced };
  }

  /**
   * Mark a session ACTIVE (first useful payload) and refresh the global entry
   * (06 §6.1). Raises the ACTIVE lifecycle event.
   */
  public async markActive(session: DeviceSession): Promise<void> {
    await this.refreshGlobal(session);
    await this.emitLifecycle(session, 'ACTIVE', null);
  }

  /** Refresh liveness + the global TTL (called on each frame after auth). */
  public async touch(session: DeviceSession): Promise<void> {
    await this.refreshGlobal(session);
  }

  /** Look up the local session owning a device (command dispatch path). */
  public byDeviceId(deviceId: string): DeviceSession | null {
    return this.byDevice.get(deviceId) ?? null;
  }

  /** Look up a session by id. */
  public bySessionId(sessionId: string): DeviceSession | null {
    return this.bySession.get(sessionId) ?? null;
  }

  /** All locally-tracked sessions (admin API / ListSessions — 06 §11.4). */
  public list(): readonly DeviceSessionSnapshot[] {
    return [...this.bySession.values()].map((s) => s.toSnapshot());
  }

  /**
   * Tear down a session: transition it, remove global + local indexes, and raise
   * the DISCONNECTED lifecycle event (06 §6.1, §11.5).
   *
   * The Redis entry is removed CONDITIONALLY (only when it still names this
   * session): when a reconnect has already claimed the global slot, the closing
   * session must not delete the new session's entry (Sprint D §7).
   */
  public async close(
    session: DeviceSession,
    reason: CloseReason,
    now: Date = new Date(),
  ): Promise<void> {
    const id = session.id as string;
    // Capture liveness up-front: an already-CLOSED session (e.g. its socket
    // cleanup arrives after a manager-initiated duplicate close) must not emit a
    // second DISCONNECTED lifecycle event.
    const wasLive = session.isLive;
    if (session.isLive) {
      session.disconnect(reason, now);
    }
    session.close(now);
    if (session.deviceId && this.byDevice.get(session.deviceId) === session) {
      this.byDevice.delete(session.deviceId);
    }
    this.bySession.delete(id);
    this.byUdpSource.delete(
      udpSourceKey(session.protocolId, session.remoteAddress, session.remotePort),
    );
    this.establishedAt.delete(id);
    this.supersededCheckedAt.delete(id);
    const terminator = this.terminators.get(id);
    this.terminators.delete(id);
    if (this.redisStore && session.tenantId && session.deviceId) {
      await this.redisStore
        .removeIfSession(session.tenantId, session.deviceId, id)
        .catch(() => {
          /* best-effort */
        });
    }
    // Destroy the transport socket (manager-initiated close — duplicate session,
    // sweep, shutdown). The socket's async 'close' event re-enters close() with
    // wasLive=false, so no second DISCONNECTED is emitted.
    if (terminator) {
      try {
        terminator(reason);
      } catch (err) {
        this.logger.warn(`Terminator for session ${id} failed: ${(err as Error).message}`);
      }
    }
    if (wasLive) {
      await this.emitLifecycle(session, 'DISCONNECTED', reason);
    }
  }

  /** Close every tracked session (graceful shutdown — Sprint D §36). */
  public async closeAll(reason: CloseReason, now: Date = new Date()): Promise<void> {
    const sessions = [...this.bySession.values()];
    await Promise.all(
      sessions.map((s) =>
        this.close(s, reason, now).catch((err) => {
          this.logger.warn(`Shutdown close failed: ${(err as Error).message}`);
        }),
      ),
    );
  }

  /** EstablishedAt (ms) for last-write-wins comparison (06 §6.3). */
  public establishedAtFor(sessionId: string): number | null {
    return this.establishedAt.get(sessionId) ?? null;
  }

  /**
   * Periodic liveness sweep (Sprint D §7/§10):
   *   - unauthenticated sessions past the auth grace → IDLE_TIMEOUT close;
   *   - UDP pseudo-sessions idle past their TTL → TTL_EXPIRED close;
   *   - authenticated TCP sessions whose Redis snapshot was overwritten by a
   *     newer session (cross-instance reconnect) → DUPLICATE_SESSION close.
   *
   * Cheap by design: local-map scans + a throttled Redis GET per session.
   */
  public async sweep(now: Date = new Date()): Promise<SweepResult> {
    const result: SweepResult = { closedAuthGrace: 0, closedUdpTtl: 0, closedSuperseded: 0 };
    const authGraceClosures: DeviceSession[] = [];
    const udpTtlClosures: DeviceSession[] = [];

    for (const session of this.bySession.values()) {
      if (!session.isLive) continue;
      const unauthenticated = session.state === 'NEW' || session.state === 'IDENTIFY';
      if (
        unauthenticated &&
        now.getTime() - session.createdAt.getTime() >= this.options.authGraceMs
      ) {
        authGraceClosures.push(session);
        continue;
      }
      if (
        session.transport === 'udp' &&
        now.getTime() - session.lastSeenAt.getTime() >= this.options.udpTtlSeconds * 1000
      ) {
        udpTtlClosures.push(session);
      }
    }

    for (const s of authGraceClosures) {
      await this.close(s, 'IDLE_TIMEOUT', now).catch(() => {});
      result.closedAuthGrace++;
    }
    for (const s of udpTtlClosures) {
      await this.close(s, 'TTL_EXPIRED', now).catch(() => {});
      result.closedUdpTtl++;
    }

    result.closedSuperseded = await this.detectSuperseded(now);
    return result;
  }

  // --- internals -------------------------------------------------------------

  /** Close the prior LIVE local session for a device (newest wins, §8). */
  private async evictLocalDuplicate(deviceId: string, incoming: DeviceSession): Promise<void> {
    const prior = this.byDevice.get(deviceId);
    if (!prior || prior === incoming || !prior.isLive) return;
    this.logger.warn(
      `Duplicate connection for device ${deviceId}: closing prior session ${prior.id} ` +
        `(DUPLICATE_SESSION — newest connection wins).`,
    );
    await this.close(prior, 'DUPLICATE_SESSION').catch((err) => {
      this.logger.warn(`Prior-session close failed: ${(err as Error).message}`);
    });
  }

  /**
   * Cross-instance supersession check: our Redis snapshot has been overwritten
   * by a session with a different sessionID → close ours (DUPLICATE_SESSION).
   */
  private async detectSuperseded(now: Date): Promise<number> {
    if (!this.redisStore) return 0;
    const nowMs = now.getTime();
    let closed = 0;
    for (const session of this.bySession.values()) {
      if (!session.isLive || !session.deviceId || !session.tenantId) continue;
      const id = session.id as string;
      const last = this.supersededCheckedAt.get(id) ?? 0;
      if (nowMs - last < this.options.supersededCheckIntervalMs) continue;
      this.supersededCheckedAt.set(id, nowMs);
      const global = await this.redisStore
        .get(session.tenantId, session.deviceId)
        .catch(() => null);
      if (global && global.sessionID !== id) {
        this.logger.warn(
          `Session ${id} for device ${session.deviceId} superseded by ${global.sessionID} ` +
            `on instance ${global.instanceID} — closing (DUPLICATE_SESSION).`,
        );
        await this.close(session, 'DUPLICATE_SESSION', now).catch(() => {});
        closed++;
      }
    }
    return closed;
  }

  private ttlFor(transport: Transport): number {
    return transport === 'udp' ? this.options.udpTtlSeconds : this.options.tcpTtlSeconds;
  }

  private async refreshGlobal(session: DeviceSession): Promise<void> {
    if (!this.redisStore || !session.tenantId || !session.deviceId) return;
    await this.redisStore
      .upsertSnapshot(session.toSnapshot(), this.ttlFor(session.transport), this.instanceId)
      .catch(() => {
        /* best-effort — L2 down degrades cross-instance dispatch (06 §15.4). */
      });
  }

  private async emitLifecycle(
    session: DeviceSession,
    state: string,
    reason: string | null,
  ): Promise<void> {
    if (!this.emitter) return;
    try {
      await this.emitter.publishSessionLifecycle({
        sessionId: session.id as string,
        deviceId: session.deviceId,
        tenantId: session.tenantId,
        state,
        reason,
        protocolId: session.protocolId,
        at: new Date(),
      });
    } catch (err) {
      this.logger.warn(`session-lifecycle emit failed: ${(err as Error).message}`);
    }
  }
}

function udpSourceKey(protocolId: string, remoteAddress: string, remotePort: number): string {
  return `${protocolId}|${remoteAddress}:${remotePort}`;
}
