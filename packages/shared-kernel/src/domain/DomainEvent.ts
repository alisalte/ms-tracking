/**
 * Domain Event base — aligned with CloudEvents v1.0 plus FleetVision extensions
 * (docs/specs/01_Master_Architecture.md §6.2 event envelope). A domain event is raised by
 * an aggregate when its state changes; it is the unit of cross-context
 * communication and Event Sourcing replay (ADR-001).
 */

/** FleetVision-specific extensions carried on every domain event. */
export interface FleetVisionEventContext {
  /** Owning tenant; always derived from the principal, never request body (INV-I02). */
  readonly tenant_id: string;
  /** W3C trace correlation; joins logs, traces, and events. */
  readonly correlation_id: string;
  /** Id of the command/event that caused this one (causation chain). */
  readonly causation_id?: string;
  /** Aggregate instance the event applies to. */
  readonly aggregate_id: string;
  readonly aggregate_type: string;
  /** Monotonic version of the aggregate after the event (event-sourced aggregates). */
  readonly aggregate_version: number;
}

/** Base shape every domain event conforms to (CloudEvents-aligned). */
export abstract class DomainEvent {
  public readonly specversion = '1.0';
  public readonly time: string;
  public readonly id: string;
  public abstract readonly type: string;

  /** The aggregate-qualified source, e.g. `/identity-service`. */
  public abstract readonly source: string;

  /** FleetVision extensions. Populated by the publishing infrastructure. */
  public readonly fleetvision: FleetVisionEventContext;

  constructor(context: FleetVisionEventContext) {
    this.id = cryptoRandomUuid();
    this.time = new Date().toISOString();
    this.fleetvision = context;
  }
}

/** Minimal UUID generator — uses the Web Crypto API available in Node 22. */
function cryptoRandomUuid(): string {
  return globalThis.crypto.randomUUID();
}
