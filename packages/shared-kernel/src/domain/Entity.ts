/**
 * Entity base. Entities have identity (an id) and a lifecycle; their equality
 * is based on id, not property values (contrast with ValueObject).
 * Internal entities are only ever accessed through their aggregate root.
 */
import type { AnyId } from './Identifier.js';

export abstract class Entity<TId extends AnyId = AnyId> {
  protected constructor(public readonly id: TId) {}

  /** Entity equality is identity-based. */
  public equals(other: Entity<TId>): boolean {
    if (other === this) return true;
    if (!(other instanceof Entity)) return false;
    return this.id === other.id;
  }
}
