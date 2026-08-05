/**
 * Aggregate Root base. An aggregate is a consistency boundary: one transaction
 * loads one aggregate, mutates it, persists it, and publishes its events.
 * (Codebase Architecture §5: "one transaction = one aggregate".)
 *
 * This base owns the uncommitted-event collection and the optimistic-version
 * field used by event-sourced aggregates (ADR-001).
 */
import type { DomainEvent } from './DomainEvent.js';
import { Entity } from './Entity.js';
import type { AnyId } from './Identifier.js';

export abstract class AggregateRoot<TId extends AnyId = AnyId> extends Entity<TId> {
  /** Uncommitted domain events, drained by the repository on save. */
  private readonly _events: DomainEvent[] = [];
  /** Monotonic version for optimistic concurrency (event-sourced aggregates). */
  private _version = 0;

  protected constructor(id: TId, version = 0) {
    super(id);
    this._version = version;
  }

  public get version(): number {
    return this._version;
  }

  /** Raise a domain event — recorded for publication via the transactional outbox. */
  protected raise(event: DomainEvent): void {
    this._events.push(event);
    this._version += 1;
  }

  /** Drain uncommitted events (the repository publishes then clears). */
  public pullEvents(): DomainEvent[] {
    return this._events.splice(0, this._events.length);
  }

  /** Used by event-store repositories to mark events as committed. */
  public markEventsCommitted(): void {
    this._events.length = 0;
  }
}
