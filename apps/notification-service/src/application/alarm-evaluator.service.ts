/**
 * AlarmEvaluatorService — the orchestrator that processes incoming telemetry
 * signals, evaluates them against active alarm rules, runs dedup, and creates
 * alarm occurrences + emits realtime events.
 *
 * Flow: Kafka consumer → processPosition/processDeviceStatus/processTrip
 *   → load enabled rules for the tenant
 *   → for each rule matching the vehicle, run the evaluator
 *   → if an AlarmEvent is produced, check dedup (Redis)
 *   → if not suppressed, create an AlarmOccurrence (persist) + emit WS event
 *
 * Geofence alarms require async spatial queries, so they're handled inline here
 * (not via the sync evaluator registry). Sprint G adds the same inline handling
 * for overspeed (grace period + recovery) — see evaluateOverspeed.
 *
 * Sprint G semantics implemented here:
 *   - Rule scope precedence (Part 9): a vehicle-scoped rule of a given type
 *     suppresses tenant-wide rules of the SAME type for that vehicle
 *     (vehicle > tenant — there is no fleet scope yet; fleet membership lives
 *     in fleet-management-service and is not duplicated here).
 *   - Overspeed grace period (Part 13): conditions.gracePeriodSec > 0 requires
 *     sustained speeding before raising.
 *   - Overspeed recovery (Part 14): speed back at/below the limit auto-resolves
 *     the OPEN alarm (actor `system`) — no flapping: re-raising requires a new
 *     grace window.
 *   - Device recovery (Part 17): a device ONLINE transition auto-resolves OPEN
 *     device_offline alarms for that vehicle.
 *   - One-open-alarm dedup (Part 12): while an OPEN alarm exists for a
 *     (rule, vehicle, type) triple, additional detections UPDATE its metadata
 *     (occurrenceCount/lastSeenAt) instead of creating new alarms.
 */
import { randomUUID } from 'node:crypto';
import type { TelemetryMetrics } from '@fleetvision/observability';
import { Injectable, Logger } from '@nestjs/common';
import type { AlarmEvent } from '../domain/alarm-event.js';
import { AlarmOccurrence } from '../domain/alarm-occurrence.js';
import type { AlarmRule } from '../domain/alarm-rule.js';
import type { AlarmStateCache } from '../infrastructure/cache/alarm-state-cache.js';
import type { AlarmOccurrenceRepository } from '../infrastructure/persistence/alarm-occurrence.repository.js';
import type { AlarmRuleRepository } from '../infrastructure/persistence/alarm-rule.repository.js';
import type { GeofenceQuery } from '../infrastructure/persistence/geofence-query.js';
import type { AlarmRealtimeGateway } from '../infrastructure/websocket/alarm-realtime.gateway.js';
import { buildEvaluatorRegistry } from './evaluators/evaluators.js';
import type { InputSignal } from './evaluators/rule-evaluator.js';
import type { NotificationDispatcherService } from './notification-dispatcher.service.js';

export interface AlarmEvaluatorDeps {
  readonly rules: AlarmRuleRepository;
  readonly alarms: AlarmOccurrenceRepository;
  readonly stateCache: AlarmStateCache;
  readonly geofenceQuery: GeofenceQuery;
  readonly gateway: AlarmRealtimeGateway | null;
  readonly dispatcher: NotificationDispatcherService | null;
  /** Sprint G observability (optional — unit tests construct without). */
  readonly metrics?: TelemetryMetrics | null;
}

@Injectable()
export class AlarmEvaluatorService {
  private readonly logger = new Logger('AlarmEvaluator');
  private readonly evaluators = buildEvaluatorRegistry();
  private readonly metrics: TelemetryMetrics | null;

  constructor(private readonly deps: AlarmEvaluatorDeps) {
    this.metrics = deps.metrics ?? null;
  }

  /** Process a position signal from Kafka. */
  public async processPosition(signal: InputSignal & { kind: 'position' }): Promise<void> {
    try {
      const rules = await this.deps.rules.listEnabled(signal.tenantId);
      const geofenceRules: AlarmRule[] = [];
      for (const rule of this.rulesForVehicle(rules, signal.vehicleId)) {
        if (rule.type === 'geofence_enter' || rule.type === 'geofence_exit') {
          geofenceRules.push(rule);
          continue;
        }
        if (rule.type === 'overspeed') {
          await this.evaluateOverspeed(signal, rule);
          continue;
        }
        const evaluator = this.evaluators.get(rule.type);
        if (!evaluator) continue;
        const event = evaluator.evaluate(signal, rule);
        if (event) await this.raiseIfAllowed(event, rule);
      }
      if (geofenceRules.length > 0) {
        await this.evaluateGeofences(signal, geofenceRules);
      }
    } catch (err) {
      this.metrics?.eventsFailed.inc({ source: 'position' });
      this.logger.warn(`Position alarm evaluation error: ${(err as Error).message}`);
    }
  }

  /** Process a device-status signal (session lifecycle or FleetEvent). */
  public async processDeviceStatus(signal: InputSignal & { kind: 'device_status' }): Promise<void> {
    try {
      const rules = await this.deps.rules.listEnabled(signal.tenantId);
      for (const rule of this.rulesForVehicle(rules, signal.vehicleId)) {
        if (rule.type === 'device_offline') {
          if (signal.state === 'ONLINE') {
            // Part 17 — device recovered: auto-resolve the open offline alarm.
            await this.autoResolve(
              signal.tenantId,
              rule,
              signal.vehicleId,
              'device_offline',
              'Device back online.',
            );
            continue;
          }
          const evaluator = this.evaluators.get(rule.type);
          if (!evaluator) continue;
          const event = evaluator.evaluate(signal, rule);
          if (event) await this.raiseIfAllowed(event, rule);
          continue;
        }
        const evaluator = this.evaluators.get(rule.type);
        if (!evaluator) continue;
        const event = evaluator.evaluate(signal, rule);
        if (event) await this.raiseIfAllowed(event, rule);
      }
    } catch (err) {
      this.metrics?.eventsFailed.inc({ source: 'session' });
      this.logger.warn(`Device-status alarm evaluation error: ${(err as Error).message}`);
    }
  }

  /** Process a trip boundary signal (gps-engine FleetEvent topic). */
  public async processTrip(signal: InputSignal & { kind: 'trip' }): Promise<void> {
    try {
      const rules = await this.deps.rules.listEnabled(signal.tenantId);
      for (const rule of this.rulesForVehicle(rules, signal.vehicleId)) {
        const evaluator = this.evaluators.get(rule.type);
        if (!evaluator) continue;
        const event = evaluator.evaluate(signal, rule);
        if (event) await this.raiseIfAllowed(event, rule);
      }
    } catch (err) {
      this.metrics?.eventsFailed.inc({ source: 'tracking' });
      this.logger.warn(`Trip alarm evaluation error: ${(err as Error).message}`);
    }
  }

  /** Process an idle FSM signal (gps-engine FleetEvent topic — Sprint G Part 19). */
  public async processIdle(signal: InputSignal & { kind: 'idle' }): Promise<void> {
    try {
      const rules = await this.deps.rules.listEnabled(signal.tenantId);
      for (const rule of this.rulesForVehicle(rules, signal.vehicleId)) {
        const evaluator = this.evaluators.get(rule.type);
        if (!evaluator) continue;
        const event = evaluator.evaluate(signal, rule);
        if (event) await this.raiseIfAllowed(event, rule);
      }
    } catch (err) {
      this.metrics?.eventsFailed.inc({ source: 'tracking' });
      this.logger.warn(`Idle alarm evaluation error: ${(err as Error).message}`);
    }
  }

  /** Process a parking FSM signal (gps-engine FleetEvent topic — Sprint G Part 19). */
  public async processParking(signal: InputSignal & { kind: 'parking' }): Promise<void> {
    try {
      const rules = await this.deps.rules.listEnabled(signal.tenantId);
      for (const rule of this.rulesForVehicle(rules, signal.vehicleId)) {
        const evaluator = this.evaluators.get(rule.type);
        if (!evaluator) continue;
        const event = evaluator.evaluate(signal, rule);
        if (event) await this.raiseIfAllowed(event, rule);
      }
    } catch (err) {
      this.metrics?.eventsFailed.inc({ source: 'tracking' });
      this.logger.warn(`Parking alarm evaluation error: ${(err as Error).message}`);
    }
  }

  /**
   * Rule scope precedence (Part 9): within one rule TYPE, a vehicle-scoped
   * rule (entityId === vehicleId) suppresses tenant-wide rules (entityId ===
   * null) for that vehicle. Deterministic, documented, no silent conflicts.
   */
  private rulesForVehicle(rules: readonly AlarmRule[], vehicleId: string): AlarmRule[] {
    const applicable = rules.filter((r) => r.appliesTo(vehicleId));
    const vehicleScopedTypes = new Set(
      applicable.filter((r) => r.entityId === vehicleId).map((r) => r.type),
    );
    return applicable.filter((r) => r.entityId !== null || !vehicleScopedTypes.has(r.type));
  }

  /**
   * Overspeed with grace period + recovery (Parts 13/14). Inline (like
   * geofence) because it needs Redis state: when sustained speeding began.
   */
  private async evaluateOverspeed(
    signal: InputSignal & { kind: 'position' },
    rule: AlarmRule,
  ): Promise<void> {
    const threshold = rule.conditionNum('thresholdKmh', 120);
    const graceSec = rule.conditionNum('gracePeriodSec', 0);
    const speeding = signal.speedKph > threshold && signal.speedKph <= 300;

    if (!speeding) {
      // Condition cleared — recovery (Part 14). Resolve the open alarm once;
      // clearing the grace state makes re-raising require a fresh window.
      await this.deps.stateCache.clearOverspeedSince(signal.tenantId, rule.id, signal.vehicleId);
      await this.autoResolve(
        signal.tenantId,
        rule,
        signal.vehicleId,
        'overspeed',
        `Speed returned to ${signal.speedKph.toFixed(1)} km/h (limit ${threshold} km/h).`,
      );
      return;
    }

    const nowMs = Date.parse(signal.capturedAt);
    if (Number.isNaN(nowMs)) return; // invalid timestamp — validation should have caught
    if (graceSec > 0) {
      const since = await this.deps.stateCache.getOverspeedSince(
        signal.tenantId,
        rule.id,
        signal.vehicleId,
      );
      if (since === null) {
        // Window opens now — not yet sustained.
        await this.deps.stateCache.setOverspeedSince(
          signal.tenantId,
          rule.id,
          signal.vehicleId,
          nowMs,
        );
        return;
      }
      if (nowMs - since < graceSec * 1000) return; // still inside the grace period
    }

    await this.raiseIfAllowed(
      {
        ruleId: rule.id,
        type: 'overspeed',
        tenantId: signal.tenantId,
        vehicleId: signal.vehicleId,
        severity: rule.severity,
        lat: signal.lat,
        lng: signal.lng,
        message: `Vehicle exceeded speed limit: ${signal.speedKph.toFixed(1)} km/h (limit ${threshold} km/h)`,
        sourceEvent: {
          kind: 'position',
          speedKph: signal.speedKph,
          capturedAt: signal.capturedAt,
          sourceEventId: signal.sourceEventId,
        },
        detectedAt: new Date(signal.capturedAt),
      },
      rule,
    );
  }

  /**
   * Evaluate geofence enter/exit by querying PostGIS ONCE per signal and
   * tracking per-vehicle state in Redis (Parts 15/16). Duplicate positions and
   * GPS jitter cannot flap ENTER/ENTER: state transitions require an actual
   * inside-set change.
   */
  private async evaluateGeofences(
    signal: InputSignal & { kind: 'position' },
    geofenceRules: readonly AlarmRule[],
  ): Promise<void> {
    const currentInside = await this.deps.geofenceQuery.containsPoint(
      signal.tenantId,
      signal.lat,
      signal.lng,
    );
    const prevState = await this.deps.stateCache.getGeofenceState(
      signal.tenantId,
      signal.vehicleId,
    );
    const currentSet = new Set(currentInside);

    for (const rule of geofenceRules) {
      const targetGeofenceId = rule.conditions.geofenceId as string | undefined;
      if (rule.type === 'geofence_enter') {
        const entered = targetGeofenceId
          ? currentSet.has(targetGeofenceId) && !prevState.has(targetGeofenceId)
          : currentInside.some((id) => !prevState.has(id));
        if (entered) {
          await this.raiseIfAllowed(
            {
              ruleId: rule.id,
              type: 'geofence_enter',
              tenantId: signal.tenantId,
              vehicleId: signal.vehicleId,
              severity: rule.severity,
              lat: signal.lat,
              lng: signal.lng,
              message: targetGeofenceId
                ? `Entered geofence ${targetGeofenceId}`
                : 'Entered a geofence zone',
              sourceEvent: {
                kind: 'position',
                geofenceIds: currentInside,
                capturedAt: signal.capturedAt,
                sourceEventId: signal.sourceEventId,
              },
              detectedAt: new Date(signal.capturedAt),
            },
            rule,
          );
        }
      }
      if (rule.type === 'geofence_exit') {
        const exited = targetGeofenceId
          ? prevState.has(targetGeofenceId) && !currentSet.has(targetGeofenceId)
          : [...prevState].some((id) => !currentSet.has(id));
        if (exited) {
          await this.raiseIfAllowed(
            {
              ruleId: rule.id,
              type: 'geofence_exit',
              tenantId: signal.tenantId,
              vehicleId: signal.vehicleId,
              severity: rule.severity,
              lat: signal.lat,
              lng: signal.lng,
              message: targetGeofenceId
                ? `Exited geofence ${targetGeofenceId}`
                : 'Exited a geofence zone',
              sourceEvent: {
                kind: 'position',
                geofenceIds: currentInside,
                capturedAt: signal.capturedAt,
                sourceEventId: signal.sourceEventId,
              },
              detectedAt: new Date(signal.capturedAt),
            },
            rule,
          );
        }
      }
    }

    // Persist the new inside-set once per signal (Part 16 — state, not edges).
    await this.deps.stateCache.setGeofenceState(signal.tenantId, signal.vehicleId, currentSet);
  }

  /**
   * Run dedup check; if allowed, persist the occurrence + emit realtime.
   *
   * Dedup strategy (Part 12):
   *   1. Redis time-window gate (dedupWindowSec) — cheapest, storm breaker.
   *      Suppressed detections increment a per-rule+vehicle counter (metadata
   *      for the open alarm) and do NOT touch PostgreSQL.
   *   2. One-open-alarm gate — when the window expires but the condition is
   *      still active and an OPEN alarm exists for (rule, vehicle, type), the
   *      existing alarm's detail is UPDATED (occurrenceCount/lastSeenAt/last
   *      detection) instead of creating a second OPEN alarm.
   */
  private async raiseIfAllowed(event: AlarmEvent, rule: AlarmRule): Promise<void> {
    const vehicleKey = event.vehicleId ?? '_tenant';
    const suppress = await this.deps.stateCache.shouldSuppress(
      event.tenantId,
      rule.id,
      vehicleKey,
      Math.max(1, rule.dedupWindowSec),
    );
    if (suppress) {
      // Within the dedup window — count, don't persist.
      await this.deps.stateCache.incrementOccurrenceCount(event.tenantId, rule.id, vehicleKey);
      this.metrics?.duplicateEvents.inc({ source: 'alarm' });
      return;
    }

    // One-open-alarm gate (Part 12).
    const open = await this.deps.alarms.findOpenByRuleAndVehicle(
      event.tenantId,
      rule.id,
      vehicleKey,
      event.type,
    );
    if (open) {
      const count = await this.deps.stateCache.incrementOccurrenceCount(
        event.tenantId,
        rule.id,
        vehicleKey,
      );
      const detail = {
        ...(open.detail ?? {}),
        occurrenceCount: count,
        lastSeenAt: new Date().toISOString(),
        lastDetection: event.sourceEvent ?? null,
      };
      await this.deps.alarms.updateDetail(open, detail);
      this.logger.debug(
        `Updated OPEN alarm ${open.id} (${event.type}) — occurrence #${count} for vehicle ${event.vehicleId}`,
      );
      return;
    }

    // Create + persist the occurrence.
    const id = randomUUID();
    const occurrence = AlarmOccurrence.create(id, {
      tenantId: event.tenantId,
      ruleId: event.ruleId,
      type: event.type,
      severity: event.severity,
      vehicleId: event.vehicleId,
      lat: event.lat,
      lng: event.lng,
      message: event.message,
      detail: {},
      sourceEvents: [event.sourceEvent],
      raisedAt: event.detectedAt,
    });
    await this.deps.alarms.create(occurrence);
    this.metrics?.alarmsOpened.inc({ type: event.type });

    // Emit realtime alarm event (best-effort — WS may be disabled).
    this.deps.gateway?.emitAlarmCreated(event.tenantId, occurrence);

    // Dispatch notifications (in-app, websocket, email) — decoupled from delivery.
    // The dispatcher handles preferences, dedup, retry, and channel selection.
    if (this.deps.dispatcher) {
      try {
        await this.deps.dispatcher.dispatchAlarm(occurrence);
      } catch (err) {
        this.logger.warn(`Notification dispatch error: ${(err as Error).message}`);
      }
    }

    this.logger.log(
      `Raised alarm ${event.type} alarmId=${id} ruleId=${rule.id} vehicle=${event.vehicleId} tenant=${event.tenantId}`,
    );
  }

  /**
   * System auto-resolve (Parts 14/17): resolve the OPEN alarm of the given
   * type for a rule+vehicle, actor `system`, with an audit row. No-op when
   * no open alarm exists (also clears flapping: RESOLVED → nothing).
   */
  private async autoResolve(
    tenantId: string,
    rule: AlarmRule,
    vehicleId: string,
    type: string,
    reason: string,
  ): Promise<void> {
    const open = await this.deps.alarms.findOpenByRuleAndVehicle(
      tenantId,
      rule.id,
      vehicleId,
      type,
    );
    if (!open || open.status === 'RESOLVED') return;
    const prev = open.status;
    open.resolve(null, reason); // null actor = system auto-resolve (uuid-safe)
    await this.deps.alarms.updateStatus(open, 'RESOLVE', prev, open.status, null, reason);
    this.metrics?.alarmsResolved.inc({ actor: 'system' });
    this.deps.gateway?.emitAlarmResolved(tenantId, open);
    this.logger.log(
      `Auto-resolved alarm ${open.id} (${type}) vehicle=${vehicleId} tenant=${tenantId} — ${reason}`,
    );
  }
}
