/**
 * ConnectionPool — the per-pod bounded connection gate (06 §5).
 *
 * Each pod maintains a bounded connection pool (default cap 100K TCP sockets —
 * 06 §5.1). When full, the gateway stops accepting so the load balancer retries
 * another pod or the device retries. This is **back-pressure, not silent drop**
 * (06 §5.3: "back-pressure > data loss").
 *
 * Eviction policy (06 §5.2):
 *   1. NEW > 10s first (never authenticated);
 *   2. then no-data > 3x reporting interval;
 *   3. **never** authenticated-with-data sessions.
 *
 * The pool tracks sessions by SessionId and reports pressure so the transport
 * can pause its accept loop. Eviction emits a reason for the session-lifecycle
 * event (06 §5.2 — "eviction emits a connection.closed admin event with reason").
 */
import type { DeviceSession, DeviceSessionSnapshot } from '../domain/index.js';

export interface ConnectionPoolOptions {
  /** Max concurrent live sessions (06 §5.1 — default 100K). */
  readonly maxConnections: number;
  /** Reporting interval (ms) — used by the no-data eviction rule (06 §5.2). */
  readonly reportingIntervalMs: number;
  /** Headroom below the cap at which to start evicting (06 §5.2 pressure). */
  readonly evictionThreshold: number;
}

export interface PoolPressure {
  /** Current live session count. */
  readonly active: number;
  /** Configured cap. */
  readonly capacity: number;
  /** True when at/over the eviction threshold — transport should pause accept. */
  readonly saturated: boolean;
  /** True when at the hard cap — transport must reject new accepts. */
  readonly full: boolean;
}

/** A candidate session the pool proposes to evict under pressure (06 §5.2). */
export interface EvictionCandidate {
  readonly sessionId: string;
  readonly reason: 'NEW_UNAUTHENTICATED' | 'NO_DATA';
}

export class ConnectionPool {
  private readonly sessions = new Map<string, DeviceSession>();
  private readonly options: ConnectionPoolOptions;

  constructor(options: ConnectionPoolOptions) {
    this.options = options;
  }

  /**
   * Admit a session. Returns false (reject) when the pool is at the hard cap —
   * the transport must close the new socket and let the LB retry (06 §5.1).
   */
  public admit(session: DeviceSession): boolean {
    if (this.sessions.size >= this.options.maxConnections) {
      return false;
    }
    this.sessions.set(session.id as string, session);
    return true;
  }

  /** Remove a session (on close/disconnect). */
  public release(sessionId: string): DeviceSession | null {
    const s = this.sessions.get(sessionId) ?? null;
    this.sessions.delete(sessionId);
    return s;
  }

  /** All currently-tracked live sessions. */
  public get active(): number {
    return this.sessions.size;
  }

  /** Current pressure state — the transport reads this on each accept. */
  public pressure(): PoolPressure {
    const active = this.sessions.size;
    return {
      active,
      capacity: this.options.maxConnections,
      saturated: active >= this.options.evictionThreshold,
      full: active >= this.options.maxConnections,
    };
  }

  /**
   * Find eviction candidates under pressure, in policy order (06 §5.2):
   *   1. NEW unauthenticated older than the auth-grace;
   *   2. no-data sessions older than 3x reporting interval;
   * never authenticated-with-data. Returns at most `max` candidates.
   */
  public pickEvictionCandidates(
    now: Date,
    authGraceMs: number,
    max: number,
  ): readonly EvictionCandidate[] {
    const candidates: { id: string; reason: EvictionCandidate['reason']; key: number }[] = [];
    const nowMs = now.getTime();
    const noDataAfterMs = 3 * this.options.reportingIntervalMs;
    for (const session of this.sessions.values()) {
      if (!session.isLive) continue;
      if (session.state === 'NEW' || session.state === 'IDENTIFY') {
        const age = nowMs - session.createdAt.getTime();
        if (age > authGraceMs) {
          candidates.push({ id: session.id as string, reason: 'NEW_UNAUTHENTICATED', key: age });
        }
      } else if (
        (session.state === 'AUTHENTICATED' || session.state === 'ACTIVE') &&
        session.firstDataAt === null
      ) {
        const sinceAuth = nowMs - session.createdAt.getTime();
        if (sinceAuth > noDataAfterMs) {
          candidates.push({ id: session.id as string, reason: 'NO_DATA', key: sinceAuth });
        }
      }
      // AUTHENTICATED/ACTIVE with firstDataAt set → never evict (06 §5.2).
    }
    // Oldest first within each tier; NEW_UNAUTHENTICATED takes precedence.
    candidates.sort((a, b) => {
      if (a.reason !== b.reason) return a.reason === 'NEW_UNAUTHENTICATED' ? -1 : 1;
      return b.key - a.key;
    });
    return candidates.slice(0, max).map((c) => ({ sessionId: c.id, reason: c.reason }));
  }

  /** Snapshot of all sessions (admin API — 06 §11.4 ListSessions). */
  public snapshot(): readonly DeviceSessionSnapshot[] {
    return [...this.sessions.values()].map((s) => s.toSnapshot());
  }

  /** Look up a session by id (command dispatch path). */
  public get(sessionId: string): DeviceSession | null {
    return this.sessions.get(sessionId) ?? null;
  }
}
