/**
 * Branded identifier primitives.
 *
 * A branded type is a nominal type layered onto a structural primitive, so that
 * a `TenantId` is not assignable to a `UserId` even though both wrap a string.
 * This prevents the entire class of "passed the wrong id" bugs at compile time —
 * the kind of bug that is catastrophic on a multi-tenant platform (BG-5: a
 * tenant-isolation breach is SEV-1).
 *
 * See Codebase Architecture §9 (`Identifier.ts — branded id types`).
 */

/** The brand symbol — nominal typing on top of a structural primitive. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** Any branded identifier — string-backed by convention (UUIDs, ULIDs). */
export type AnyId = Brand<string, string>;

/**
 * Define a branded id type for a new aggregate.
 * Usage: `export type VehicleId = defineId('VehicleId');`
 */
export function defineId<const B extends string>(_brand: B): Brand<string, B> {
  void _brand;
  throw new Error('defineId is a type-level helper — do not call it at runtime');
}

/** Construct a branded id from a raw string (at trust boundaries / rehydration). */
export function asId<B extends string>(value: string, _brand: B): Brand<string, B> {
  return value as Brand<string, B>;
}
