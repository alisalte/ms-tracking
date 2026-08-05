/**
 * Heartbeat & liveness policy (06 §12).
 *
 * Three deliberately distinct concepts (06 §12.1/§12.2):
 *   - Connection liveness: is the socket/pseudo-session open? (per transport)
 *   - Data liveness: time since last *useful* payload (POSITION/TELEMETRY);
 *     drives "stale device" at 3x the reporting interval.
 *   - Auth grace: a NEW/IDENTIFY session older than this is closed (>10s).
 *
 * The gateway never maintains a per-connection timer for idle timeout on TCP —
 * `socket.setTimeout()` does that O(1) (06 §12.2). This policy is the pure
 * decision function the supervisor (UDP TTL sweeper, auth-grace sweep, stale
 * detector) calls against a session snapshot. Keeping it pure makes the rules
 * trivially testable and shared across transports.
 */
import type { DeviceSession, SessionState } from './device-session.js';

export interface HeartbeatPolicyOptions {
  /** TCP idle timeout in ms (06 §12.2; default 180s). */
  readonly tcpIdleTimeoutMs: number;
  /** UDP pseudo-session TTL in ms (06 §4.4; default 2x report interval). */
  readonly udpSessionTtlMs: number;
  /** Auth grace in ms — NEW/IDENTIFY older than this is expired (06 §12.4). */
  readonly authGraceMs: number;
  /** Data-liveness = staleFactor * reportingIntervalMs (06 §12.1; default 3x). */
  readonly staleFactor: number;
  /** Default reporting interval when a device hasn't declared one (ms). */
  readonly defaultReportingIntervalMs: number;
}

export const DEFAULT_HEARTBEAT_POLICY: HeartbeatPolicyOptions = {
  tcpIdleTimeoutMs: 180_000,
  udpSessionTtlMs: 120_000,
  authGraceMs: 10_000,
  staleFactor: 3,
  defaultReportingIntervalMs: 60_000,
};

/** Why a session is considered timed out by the policy. */
export type TimeoutReason = 'IDLE_TIMEOUT' | 'TTL_EXPIRED' | 'AUTH_GRACE' | 'STALE_DATA';

export interface TimeoutDecision {
  readonly timedOut: boolean;
  readonly reason: TimeoutReason | null;
}

export class HeartbeatPolicy {
  constructor(private readonly options: HeartbeatPolicyOptions = DEFAULT_HEARTBEAT_POLICY) {}

  /**
   * Decide whether a session has timed out as of `now`. Pure: no mutation.
   *
   * Rules (06 §12.4):
   *   - NEW/IDENTIFY beyond authGrace → AUTH_GRACE (close unauthenticated).
   *   - TCP live session idle beyond tcpIdleTimeout → IDLE_TIMEOUT.
   *   - UDP pseudo-session beyond udpSessionTtl since lastSeen → TTL_EXPIRED.
   *   - AUTHENTICATED/ACTIVE with no useful data beyond staleFactor*interval → STALE_DATA.
   *
   * Returns `{ timedOut: false }` for terminal (CLOSED/DISCONNECTED/CLOSING) sessions.
   */
  public evaluate(session: DeviceSession, now: Date = new Date()): TimeoutDecision {
    if (!session.isLive) {
      return { timedOut: false, reason: null };
    }
    const nowMs = now.getTime();
    const lastSeenMs = session.lastSeenAt.getTime();
    const sinceMs = nowMs - lastSeenMs;

    const state: SessionState = session.state;
    if (state === 'NEW' || state === 'IDENTIFY') {
      // Auth grace: time since *open*, not since last seen — a device that
      // connected but never sent a valid login frame.
      const ageMs = nowMs - session.createdAt.getTime();
      if (ageMs > this.options.authGraceMs) {
        return { timedOut: true, reason: 'AUTH_GRACE' };
      }
      return { timedOut: false, reason: null };
    }

    // AUTHENTICATED or ACTIVE.
    if (session.transport === 'tcp' && sinceMs > this.options.tcpIdleTimeoutMs) {
      return { timedOut: true, reason: 'IDLE_TIMEOUT' };
    }
    if (session.transport === 'udp' && sinceMs > this.options.udpSessionTtlMs) {
      return { timedOut: true, reason: 'TTL_EXPIRED' };
    }

    // Data liveness — only meaningful once authenticated. Measures time since
    // the last *useful* payload (06 §12.1), falling back to open time when the
    // session has never produced one.
    const staleAfterMs = this.options.staleFactor * this.options.defaultReportingIntervalMs;
    const lastDataMs = (session.lastDataAt ?? session.firstDataAt ?? session.createdAt).getTime();
    const sinceDataMs = nowMs - lastDataMs;
    if (sinceDataMs > staleAfterMs) {
      return { timedOut: true, reason: 'STALE_DATA' };
    }

    return { timedOut: false, reason: null };
  }
}
