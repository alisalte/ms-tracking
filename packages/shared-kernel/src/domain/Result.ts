/**
 * Result type — never throw for *expected* domain outcomes.
 *
 * Domain operations have two kinds of failure:
 *  - **Expected outcomes** (vehicle already assigned, HOS limit reached) — return a
 *    `Result.fail(...)`, so callers handle them with control flow, not try/catch.
 *  - **Unexpected errors** (DB down, programming bug) — throw; the exception filter
 *    maps them to a 500.
 *
 * This keeps the "happy path" linear and makes expected outcomes explicit in the
 * type system. (See Codebase Architecture §9 `Result.ts`.)
 */
export type Result<T, E = DomainFailure> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export interface DomainFailure {
  /** Canonical error code (matches API_Design.md §8.3 catalog). */
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export const Result = {
  ok: <T>(value: T): Result<T, never> => ({ ok: true, value }),
  fail: <E>(error: E): Result<never, E> => ({ ok: false, error }),
  failWith: (
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): Result<never, DomainFailure> => ({
    ok: false,
    error: { code, message, details },
  }),
};

/** Convenience type guard. */
export function isOk<T, E>(r: Result<T, E>): r is { readonly ok: true; readonly value: T } {
  return r.ok;
}
