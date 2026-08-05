/**
 * Domain Error base. Domain errors represent a violated invariant or a
 * domain-meaningful failure (e.g. VIN not unique). They are distinct from
 * infrastructure/programming errors.
 *
 * Each domain error carries a canonical `code` (matches API_Design.md §8.3) so the
 * API exception filter can map it to the JSON:API error envelope deterministically.
 */
export abstract class DomainError extends Error {
  public abstract readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
    // Restore prototype chain after extending a built-in (TS/ES2015 target).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
