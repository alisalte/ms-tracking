import type { TelemetryMetrics } from '@fleetvision/observability';
/**
 * Geofence evaluator — the Sprint I geospatial event engine (§18–§24).
 *
 * Pipeline position (stage 4.5, after the trip engine) →
 *   GeofenceEvaluator (this class) →
 *     SignalBus `geofence.event` →
 *       TrackingEventProducer → `fleetvision.tracking.events` →
 *         Alarm Engine (notification-service) → Notification Center.
 *
 * The evaluator generates GEOFENCE_ENTER / GEOFENCE_EXIT / GEOFENCE_DWELL
 * FleetEvents. It does NOT evaluate alarm rules and never sends
 * notifications — the Sprint G alarm engine stays authoritative downstream.
 *
 * ── Exact algorithm (Sprint I §21 — documented, deterministic) ─────────────
 *
 * JITTER PROTECTION = consecutive-observation state confirmation:
 *
 *   OUTSIDE ──contains──▶ CANDIDATE_IN(count=1)
 *   CANDIDATE_IN ──contains──▶ count+1; count ≥ N ⇒ INSIDE + ENTER
 *   CANDIDATE_IN ──!contains──▶ OUTSIDE (reset, no event)
 *   INSIDE ──contains──▶ (dwell check)
 *   INSIDE ──!contains──▶ CANDIDATE_OUT(count=1)
 *   CANDIDATE_OUT ──!contains──▶ count+1; count ≥ N ⇒ OUTSIDE + EXIT
 *   CANDIDATE_OUT ──contains──▶ INSIDE (bounce-back — no events)
 *
 *   N = GEOFENCE_CONFIRMATION_POINTS (default 2). A single noisy GPS point on
 *   the wrong side of the boundary can therefore NEVER flap ENTER/EXIT: the
 *   opposite state must be observed N times in a row. Upstream gates clean the
 *   input stream itself: rejected/out-of-order/stale positions are skipped and
 *   duplicates are deduped by the pipeline. (This mechanism was chosen over a
 *   geometric boundary buffer because exact distance-to-ring on geography
 *   polygons requires geometry casts PostGIS does not natively support for
 *   `geography`; confirmation-points achieves the same anti-flapping guarantee
 *   with persisted, restart-safe state.)
 *
 * DWELL (§22): on ENTER, entered_at = the confirming position's capturedAt.
 * While INSIDE, once (capturedAt − entered_at) ≥ threshold
 * (geofence.dwell_sec ?? GEOFENCE_DWELL_SECONDS, default 600 s) and DWELL is
 * enabled in the fence's alert_on, exactly ONE dwell event fires for that
 * occupancy; dwell_fired_at resets only on the next confirmed EXIT+ENTER.
 *
 * STATE (§23): every transition is persisted to `tracking.geofence_state`
 * (AFTER the events for the position are computed, in the same evaluator
 * call), so a worker restart reloads the exact state and can neither lose nor
 * duplicate a transition. Kafka redeliveries are deduplicated downstream by
 * the deterministic eventId `<messageId>:<eventType>:<geofenceId>`.
 *
 * MULTIPLE GEOFENCES (§24): each (vehicle, geofence) pair runs its own
 * independent FSM — a vehicle may be INSIDE Warehouse, Customer A and
 * Restricted Zone simultaneously.
 *
 * Deleted/archived geofences: state rows outside the candidate set whose
 * exact re-check returns null (fence gone / INACTIVE) are reset to OUTSIDE
 * silently — no EXIT event for a fence that no longer exists (documented
 * behavior).
 */
import { Logger } from '@nestjs/common';
import type { GpsEngineConfig } from '../config/gps-engine.config.js';
import type { PositionEvent } from '../domain/position-event.js';
import type {
  GeofenceCandidate,
  GeofenceDefinitionsRepository,
} from '../infrastructure/persistence/geofence-definitions.repository.js';
import type {
  GeofenceMembershipState,
  GeofenceStatePatch,
  GeofenceStateRepository,
  GeofenceStateRow,
} from '../infrastructure/persistence/geofence-state.repository.js';
import type { GeofenceSignal, SignalBus } from './signal-bus.js';

export interface GeofenceEvaluatorDeps {
  readonly config: GpsEngineConfig;
  readonly definitions: GeofenceDefinitionsRepository;
  readonly state: GeofenceStateRepository;
  readonly signalBus: SignalBus;
  readonly metrics?: TelemetryMetrics | null;
}

interface MutableState {
  state: GeofenceMembershipState;
  confirmCount: number;
  enteredAt: Date | null;
  dwellFiredAt: Date | null;
}

/** A transition-generated FleetEvent, before enrichment. */
interface PendingEvent {
  readonly type: 'geofence.entered' | 'geofence.exited' | 'geofence.dwell';
  readonly occurredAt: Date;
  readonly dwellSec: number | null;
}

export class GeofenceEvaluator {
  private readonly logger = new Logger('GeofenceEvaluator');
  private readonly metrics: TelemetryMetrics | null;

  constructor(private readonly deps: GeofenceEvaluatorDeps) {
    this.metrics = deps.metrics ?? null;
  }

  /** Evaluate one in-order position (no-op when GEOFENCE_ENABLED=false). */
  public async process(event: PositionEvent): Promise<void> {
    if (!this.deps.config.GEOFENCE_ENABLED) return;
    try {
      const candidates = await this.deps.definitions.candidatesForPosition(
        event.tenantId,
        event.vehicleId,
        event.latitude,
        event.longitude,
        this.deps.config.GEOFENCE_CANDIDATE_BUFFER_DEG,
      );
      const states = await this.deps.state.loadForVehicle(event.tenantId, event.vehicleId);
      const candidateIds = new Set(candidates.map((c) => c.id));

      for (const candidate of candidates) {
        const current = states.get(candidate.id);
        const mutable = this.snapshot(current);
        const events = this.advance(mutable, candidate, candidate.contains, event);
        for (const e of events) {
          this.emit(event, candidate, e);
        }
        if (this.stateChanged(current, mutable) || candidate.contains) {
          await this.persist(event, candidate.id, mutable);
        }
      }

      // Fences outside the candidate bbox (or deleted) with non-OUTSIDE state.
      const farPatches = await this.refreshFarStates(event, candidateIds, states);
      for (const [geofenceId, patch] of farPatches) {
        await this.deps.state.upsert(event.tenantId, event.vehicleId, geofenceId, patch);
      }
    } catch (err) {
      this.metrics?.geofenceEvalErrors.inc();
      this.logger.warn(
        `Geofence evaluation failed for vehicle ${event.vehicleId}: ${(err as Error).message}`,
      );
      // Never break the position pipeline — evaluation is derived data.
    }
  }

  /**
   * Pure FSM step (unit-tested in isolation). ONE observation drives ONE
   * state-machine step — with the N=1 shortcut that confirms immediately
   * (OUTSIDE+contains → INSIDE+ENTER without a CANDIDATE hop). Returns the
   * events generated by THIS transition, which the caller emits BEFORE
   * persisting the post-state — restart-safe ordering.
   */
  private advance(
    s: MutableState,
    candidate: GeofenceCandidate,
    contains: boolean,
    event: PositionEvent,
  ): PendingEvent[] {
    const confirmPoints = Math.max(1, this.deps.config.GEOFENCE_CONFIRMATION_POINTS);
    const events: PendingEvent[] = [];
    if (s.state === 'OUTSIDE') {
      if (!contains) return events;
      if (confirmPoints <= 1) {
        this.confirmEnter(s, event);
        events.push(this.enterEvent(event));
      } else {
        s.state = 'CANDIDATE_IN';
        s.confirmCount = 1;
      }
    } else if (s.state === 'CANDIDATE_IN') {
      if (contains) {
        s.confirmCount += 1;
        if (s.confirmCount >= confirmPoints) {
          this.confirmEnter(s, event);
          events.push(this.enterEvent(event));
        }
      } else {
        s.state = 'OUTSIDE';
        s.confirmCount = 0;
      }
    } else if (s.state === 'INSIDE') {
      if (contains) {
        this.checkDwell(s, candidate, event, events);
      } else if (confirmPoints <= 1) {
        events.push(this.exitEvent(event, s.enteredAt));
        this.confirmExit(s);
      } else {
        s.state = 'CANDIDATE_OUT';
        s.confirmCount = 1;
      }
    } else {
      // CANDIDATE_OUT
      if (!contains) {
        s.confirmCount += 1;
        if (s.confirmCount >= confirmPoints) {
          events.push(this.exitEvent(event, s.enteredAt));
          this.confirmExit(s);
        }
      } else {
        // Bounce-back before exit confirmed — still inside, dwell continues.
        s.state = 'INSIDE';
        s.confirmCount = 0;
        this.checkDwell(s, candidate, event, events);
      }
    }
    return events;
  }

  private confirmEnter(s: MutableState, event: PositionEvent): void {
    s.state = 'INSIDE';
    s.confirmCount = 0;
    s.enteredAt = event.capturedAt;
    s.dwellFiredAt = null;
  }

  private confirmExit(s: MutableState): void {
    s.state = 'OUTSIDE';
    s.confirmCount = 0;
    s.dwellFiredAt = null;
    // enteredAt is kept until the next ENTER overwrites it — the EXIT event
    // reads it for the occupancy duration before persist.
  }

  private enterEvent(event: PositionEvent): PendingEvent {
    return { type: 'geofence.entered', occurredAt: event.capturedAt, dwellSec: null };
  }

  private exitEvent(event: PositionEvent, enteredAt: Date | null): PendingEvent {
    const dwellSec = enteredAt
      ? Math.max(0, Math.round((event.capturedAt.getTime() - enteredAt.getTime()) / 1000))
      : null;
    return { type: 'geofence.exited', occurredAt: event.capturedAt, dwellSec };
  }

  private checkDwell(
    s: MutableState,
    candidate: GeofenceCandidate,
    event: PositionEvent,
    events: PendingEvent[],
  ): void {
    if (s.state !== 'INSIDE' || s.dwellFiredAt || !s.enteredAt) return;
    if (!candidate.alertOn.includes('DWELL')) return;
    const thresholdSec = Math.max(1, candidate.dwellSec ?? this.deps.config.GEOFENCE_DWELL_SECONDS);
    const elapsedSec = (event.capturedAt.getTime() - s.enteredAt.getTime()) / 1000;
    if (elapsedSec >= thresholdSec) {
      s.dwellFiredAt = event.capturedAt;
      events.push({
        type: 'geofence.dwell',
        occurredAt: event.capturedAt,
        dwellSec: Math.max(1, Math.round(elapsedSec)),
      });
    }
  }

  private emit(event: PositionEvent, candidate: GeofenceCandidate, e: PendingEvent): void {
    if (e.type === 'geofence.entered' && !candidate.alertOn.includes('ENTER')) return;
    if (e.type === 'geofence.exited' && !candidate.alertOn.includes('EXIT')) return;
    this.metrics?.geofenceEvents.inc({
      type:
        e.type === 'geofence.entered'
          ? 'entered'
          : e.type === 'geofence.exited'
            ? 'exited'
            : 'dwell',
    });
    const signal: GeofenceSignal = {
      type: e.type,
      tenantId: event.tenantId,
      vehicleId: event.vehicleId,
      geofenceId: candidate.id,
      geofenceName: candidate.name,
      dwellSec: e.dwellSec,
      occurredAt: e.occurredAt.toISOString(),
      lat: event.latitude,
      lng: event.longitude,
      sourceEventId: event.messageId,
    };
    this.deps.signalBus.emitGeofence(signal);
    this.logger.debug(
      `Geofence ${e.type} vehicle=${event.vehicleId} geofence=${candidate.id} at ${e.occurredAt.toISOString()}`,
    );
  }

  /**
   * Refresh states for fences NOT in the candidate set: if the persisted state
   * is not OUTSIDE, re-check that specific fence exactly (bounded by the
   * number of active occupancies). Fence gone / INACTIVE → silent reset to
   * OUTSIDE (no event). Returns the patches to persist.
   */
  private async refreshFarStates(
    event: PositionEvent,
    candidateIds: ReadonlySet<string>,
    states: Map<string, GeofenceStateRow>,
  ): Promise<Map<string, GeofenceStatePatch>> {
    const patches = new Map<string, GeofenceStatePatch>();
    for (const [geofenceId, row] of states) {
      if (candidateIds.has(geofenceId)) continue;
      if (row.state === 'OUTSIDE') continue;
      const contains = await this.deps.definitions.exactContains(
        event.tenantId,
        geofenceId,
        event.latitude,
        event.longitude,
      );
      if (contains === null) {
        patches.set(geofenceId, {
          state: 'OUTSIDE',
          confirmCount: 0,
          enteredAt: null,
          dwellFiredAt: null,
          lastSeenAt: event.capturedAt,
        });
        continue;
      }
      // Reuse the main FSM with a synthesized candidate so far-fence behavior
      // is IDENTICAL to in-bbox behavior (including alert_on filtering).
      const candidate: GeofenceCandidate = {
        id: geofenceId,
        name: '',
        type: 'POLYGON',
        radiusM: null,
        dwellSec: null,
        // alert_on unknown on this path — allow all, name-less events are
        // still filtered downstream by rule conditions (documented).
        alertOn: ['ENTER', 'EXIT', 'DWELL'],
        contains,
      };
      const mutable = this.snapshot(row);
      const events = this.advance(mutable, candidate, contains, event);
      for (const e of events) this.emit(event, candidate, e);
      if (this.stateChanged(row, mutable) || contains) {
        patches.set(geofenceId, {
          state: mutable.state,
          confirmCount: mutable.confirmCount,
          enteredAt: mutable.enteredAt,
          dwellFiredAt: mutable.dwellFiredAt,
          lastSeenAt: event.capturedAt,
        });
      }
    }
    return patches;
  }

  private snapshot(current: GeofenceStateRow | undefined): MutableState {
    return current
      ? {
          state: current.state,
          confirmCount: current.confirmCount,
          enteredAt: current.enteredAt,
          dwellFiredAt: current.dwellFiredAt,
        }
      : { state: 'OUTSIDE', confirmCount: 0, enteredAt: null, dwellFiredAt: null };
  }

  private stateChanged(current: GeofenceStateRow | undefined, s: MutableState): boolean {
    if (!current) return s.state !== 'OUTSIDE' || s.confirmCount !== 0;
    return (
      current.state !== s.state ||
      current.confirmCount !== s.confirmCount ||
      (current.enteredAt?.getTime() ?? null) !== (s.enteredAt?.getTime() ?? null) ||
      (current.dwellFiredAt?.getTime() ?? null) !== (s.dwellFiredAt?.getTime() ?? null)
    );
  }

  private persist(event: PositionEvent, geofenceId: string, s: MutableState): Promise<void> {
    return this.deps.state.upsert(event.tenantId, event.vehicleId, geofenceId, {
      state: s.state,
      confirmCount: s.confirmCount,
      enteredAt: s.enteredAt,
      dwellFiredAt: s.dwellFiredAt,
      lastSeenAt: event.capturedAt,
    });
  }
}
