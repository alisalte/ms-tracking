/**
 * AlarmOccurrence — a raised alarm instance with lifecycle (12_Alarm_Engine.md §6).
 *
 * Lifecycle: OPEN → ACKNOWLEDGED → RESOLVED (or OPEN → RESOLVED directly).
 * Each transition validates legality, stamps the timestamp + actor, and the
 * repository appends an audit row to notification.alert_acknowledgements.
 */
import { IllegalStatusTransitionError } from './alarm-errors.js';
import { type AlarmSeverity, type AlarmStatus, isValidTransition } from './alarm-types.js';

export interface AlarmOccurrenceProps {
  readonly tenantId: string;
  readonly ruleId: string;
  readonly type: string;
  severity: AlarmSeverity;
  status: AlarmStatus;
  readonly vehicleId: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  message: string;
  readonly detail: Record<string, unknown>;
  readonly sourceEvents: readonly unknown[];
  readonly raisedAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionReason: string | null;
}

export class AlarmOccurrence {
  public readonly tenantId: string;
  public readonly ruleId: string;
  public readonly type: string;
  public severity: AlarmSeverity;
  public status: AlarmStatus;
  public readonly vehicleId: string | null;
  public readonly lat: number | null;
  public readonly lng: number | null;
  public message: string;
  public readonly detail: Record<string, unknown>;
  public readonly sourceEvents: readonly unknown[];
  public readonly raisedAt: Date;
  public acknowledgedAt: Date | null;
  public acknowledgedBy: string | null;
  public resolvedAt: Date | null;
  public resolvedBy: string | null;
  public resolutionReason: string | null;

  public readonly id: string;
  public version: number;

  private constructor(id: string, version: number, props: AlarmOccurrenceProps) {
    this.id = id;
    this.version = version;
    this.tenantId = props.tenantId;
    this.ruleId = props.ruleId;
    this.type = props.type;
    this.severity = props.severity;
    this.status = props.status;
    this.vehicleId = props.vehicleId;
    this.lat = props.lat;
    this.lng = props.lng;
    this.message = props.message;
    this.detail = props.detail;
    this.sourceEvents = props.sourceEvents;
    this.raisedAt = props.raisedAt;
    this.acknowledgedAt = props.acknowledgedAt;
    this.acknowledgedBy = props.acknowledgedBy;
    this.resolvedAt = props.resolvedAt;
    this.resolvedBy = props.resolvedBy;
    this.resolutionReason = props.resolutionReason;
  }

  /** Factory: create a new OPEN occurrence. */
  public static create(
    id: string,
    props: Omit<
      AlarmOccurrenceProps,
      | 'status'
      | 'acknowledgedAt'
      | 'acknowledgedBy'
      | 'resolvedAt'
      | 'resolvedBy'
      | 'resolutionReason'
    >,
  ): AlarmOccurrence {
    return new AlarmOccurrence(id, 1, {
      ...props,
      status: 'OPEN',
      acknowledgedAt: null,
      acknowledgedBy: null,
      resolvedAt: null,
      resolvedBy: null,
      resolutionReason: null,
    });
  }

  /** Factory: rehydrate from persistence. */
  public static rehydrate(
    id: string,
    version: number,
    props: AlarmOccurrenceProps,
  ): AlarmOccurrence {
    return new AlarmOccurrence(id, version, props);
  }

  /** Transition to ACKNOWLEDGED. Only legal from OPEN. */
  public acknowledge(userId: string): void {
    if (!isValidTransition(this.status, 'ACKNOWLEDGED')) {
      throw new IllegalStatusTransitionError(
        `Cannot acknowledge an alarm in ${this.status} state.`,
      );
    }
    this.status = 'ACKNOWLEDGED';
    this.acknowledgedAt = new Date();
    this.acknowledgedBy = userId;
  }

  /**
   * Transition to RESOLVED. Legal from OPEN or ACKNOWLEDGED. `userId` null =
   * system auto-resolve (condition recovery — Sprint G Parts 14/17); the
   * resolution reason carries the automation context.
   */
  public resolve(userId: string | null, reason?: string): void {
    if (!isValidTransition(this.status, 'RESOLVED')) {
      throw new IllegalStatusTransitionError(`Cannot resolve an alarm in ${this.status} state.`);
    }
    this.status = 'RESOLVED';
    this.resolvedAt = new Date();
    this.resolvedBy = userId;
    this.resolutionReason = userId === null ? `[auto] ${reason ?? ''}`.trim() : (reason ?? null);
  }
}
