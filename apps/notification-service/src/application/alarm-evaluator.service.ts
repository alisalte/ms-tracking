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
 * (not via the sync evaluator registry).
 */
import { randomUUID } from 'node:crypto';
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
}

@Injectable()
export class AlarmEvaluatorService {
  private readonly logger = new Logger('AlarmEvaluator');
  private readonly evaluators = buildEvaluatorRegistry();

  constructor(private readonly deps: AlarmEvaluatorDeps) {}

  /** Process a position signal from Kafka. */
  public async processPosition(signal: InputSignal & { kind: 'position' }): Promise<void> {
    try {
      const rules = await this.deps.rules.listEnabled(signal.tenantId);
      for (const rule of rules) {
        if (!rule.appliesTo(signal.vehicleId)) continue;
        // Geofence rules need special async handling.
        if (rule.type === 'geofence_enter' || rule.type === 'geofence_exit') {
          await this.evaluateGeofence(signal, rule);
          continue;
        }
        // Standard sync evaluators.
        const evaluator = this.evaluators.get(rule.type);
        if (!evaluator) continue;
        const event = evaluator.evaluate(signal, rule);
        if (event) await this.raiseIfAllowed(event, rule);
      }
    } catch (err) {
      this.logger.warn(`Position alarm evaluation error: ${(err as Error).message}`);
    }
  }

  /** Process a device-status signal from Kafka. */
  public async processDeviceStatus(signal: InputSignal & { kind: 'device_status' }): Promise<void> {
    try {
      const rules = await this.deps.rules.listEnabled(signal.tenantId);
      for (const rule of rules) {
        if (!rule.appliesTo(signal.deviceId)) continue;
        const evaluator = this.evaluators.get(rule.type);
        if (!evaluator) continue;
        const event = evaluator.evaluate(signal, rule);
        if (event) await this.raiseIfAllowed(event, rule);
      }
    } catch (err) {
      this.logger.warn(`Device-status alarm evaluation error: ${(err as Error).message}`);
    }
  }

  /** Process a trip signal (from gps-engine's trip events on Kafka — not yet wired). */
  public async processTrip(signal: InputSignal & { kind: 'trip' }): Promise<void> {
    try {
      const rules = await this.deps.rules.listEnabled(signal.tenantId);
      for (const rule of rules) {
        if (!rule.appliesTo(signal.vehicleId)) continue;
        const evaluator = this.evaluators.get(rule.type);
        if (!evaluator) continue;
        const event = evaluator.evaluate(signal, rule);
        if (event) await this.raiseIfAllowed(event, rule);
      }
    } catch (err) {
      this.logger.warn(`Trip alarm evaluation error: ${(err as Error).message}`);
    }
  }

  /** Evaluate geofence enter/exit by querying PostGIS and tracking state in Redis. */
  private async evaluateGeofence(
    signal: InputSignal & { kind: 'position' },
    rule: AlarmRule,
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
    const targetGeofenceId = rule.conditions.geofenceId as string | undefined;

    // Enter: in current but not in previous.
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
            },
            detectedAt: new Date(signal.capturedAt),
          },
          rule,
        );
      }
    }

    // Exit: in previous but not in current.
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
            },
            detectedAt: new Date(signal.capturedAt),
          },
          rule,
        );
      }
    }

    // Update the vehicle's geofence state.
    await this.deps.stateCache.setGeofenceState(signal.tenantId, signal.vehicleId, currentSet);
  }

  /** Run dedup check; if allowed, persist the occurrence + emit realtime. */
  private async raiseIfAllowed(event: AlarmEvent, rule: AlarmRule): Promise<void> {
    // Dedup: suppress if a recent alarm for this rule+vehicle is in the window.
    const suppress = await this.deps.stateCache.shouldSuppress(
      event.tenantId,
      rule.id,
      event.vehicleId ?? '_tenant',
      rule.dedupWindowSec,
    );
    if (suppress) return; // within the dedup window — suppress the storm.

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

    this.logger.debug(`Raised alarm ${event.type} for vehicle ${event.vehicleId}`);
  }
}
