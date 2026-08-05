/**
 * Value Object base. Value objects are immutable, compared by value (not identity),
 * and self-validating — they can never be constructed in an invalid state.
 * (Codebase Architecture §5: "value objects, not primitives".)
 *
 * Example: `class Vin extends ValueObject<{ value: string }> { ... }`
 */
export abstract class ValueObject<T> {
  protected constructor(public readonly props: T) {
    Object.freeze(this);
  }

  /** Value equality — two VOs with equal props are equal. */
  public equals(other: ValueObject<T>): boolean {
    if (other === this) return true;
    if (!(other instanceof ValueObject)) return false;
    return deepEqual(this.props, other.props);
  }
}

/** Shallow-but-correct structural equality for frozen value-object props. */
function deepEqual<T>(a: T, b: T): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return false;
  }
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}
