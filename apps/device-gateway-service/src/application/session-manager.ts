/**
 * SessionManager — two-tier session store + lifecycle orchestration (06 §6).
 *
 *   Local (in-process): Map<DeviceId, Session> for O(1) command dispatch on the
 *                       owning instance (06 §6.2).
 *   Global (Redis):     tenant:<tid>:device:<did>:session → snapshot, TTL 60s
 *                       (TCP) / 2x interval (UDP). Cross-instance lookup for
 *                       "which pod holds this device?" (06 §6.2).
 *
 * Reconnection & affinity (06 §6.3): a new connection from a known DeviceID
 * replaces the session — last-write-wins on Redis with EstablishedAt comparison;
 * the prior instance detects its session superseded and closes the older
 * connection with DUPLICATE_SESSION where the protocol supports it.
 *
 * The manager is the single writer for session lifecycle events: it persists the
 * global snapshot, raises session-lifecycle Kafka events (06 §11.5), and owns the
 * local index. The dispatcher calls here on each transition.
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
}

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

export class SessionManager {
  private readonly logger = new Logger(SessionManager.name);
  /** Local index by device id (post-auth) — O(1) dispatch (06 §6.2). */
  private readonly byDevice = new Map<string, DeviceSession>();
  /** Local index by session id. */
  private readonly bySession = new Map<string, DeviceSession>();
  /** Per-session established timestamp for last-write-wins comparison (06 §6.3). */
  private readonly establishedAt = new Map<string, number>();

  constructor(
    private readonly redisStore: SessionRedisStore | null,
    private readonly emitter: SessionLifecycleEmitter | null,
    private readonly instanceId: string,
    private readonly options: SessionManagerOptions,
  ) {}

  /** Track a session locally (on open — pre-auth, no global entry yet). */
  public track(session: DeviceSession): void {
    this.bySession.set(session.id as string, session);
    this.establishedAt.set(session.id as string, session.createdAt.getTime());
  }

  /**
   * Register a session globally once authenticated. Writes the Redis snapshot
   * (last-write-wins) and raises the AUTHENTICATED lifecycle event (06 §11.5).
   * Indexes locally by deviceId for O(1) dispatch.
   */
  public async registerAuthenticated(session: DeviceSession): Promise<RegisterResult> {
    if (session.deviceId) {
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
   */
  public async close(
    session: DeviceSession,
    reason: CloseReason,
    now: Date = new Date(),
  ): Promise<void> {
    if (session.isLive) {
      session.disconnect(reason, now);
    }
    session.close(now);
    if (session.deviceId) this.byDevice.delete(session.deviceId);
    this.bySession.delete(session.id as string);
    this.establishedAt.delete(session.id as string);
    if (this.redisStore && session.tenantId && session.deviceId) {
      await this.redisStore.remove(session.tenantId, session.deviceId).catch(() => {
        /* best-effort */
      });
    }
    await this.emitLifecycle(session, 'DISCONNECTED', reason);
  }

  /** EstablishedAt (ms) for last-write-wins comparison (06 §6.3). */
  public establishedAtFor(sessionId: string): number | null {
    return this.establishedAt.get(sessionId) ?? null;
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
