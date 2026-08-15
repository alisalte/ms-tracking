/**
 * Pagination primitives — cursor-based, matching API_Design.md §2.1.
 * Cursor pagination is required on every collection endpoint (no offset paging),
 * because offset paging degrades catastrophically on high-write time-series data.
 *
 * The shared-kernel stays pure TypeScript (no framework imports — §9). The Zod
 * schema that validates a client page request lives in @fleetvision/auth
 * (`pageRequestSchema`); the constants/types/helpers here are imported by both
 * the schema and every service's cursor repository methods.
 */

/** Maximum number of rows a single page may return (guard against unbounded loads). */
export const MAX_PAGE_SIZE = 100;
/** Default page size when the client omits `limit`. */
export const DEFAULT_PAGE_SIZE = 25;

/** A page of results plus the cursor for the next page (null if exhausted). */
export interface Page<T> {
  readonly data: readonly T[];
  readonly nextCursor: string | null;
}

/** Decoded cursor — opaque to clients, structured internally. */
export interface Cursor {
  /** Field the cursor orders by. */
  readonly orderBy: string;
  /** Last value of orderBy on the current page. */
  readonly value: string;
  /** Tiebreaker id for stable ordering when orderBy is non-unique. */
  readonly id?: string;
}

/** Client-supplied page request (limit + optional opaque cursor). */
export interface PageRequest {
  readonly limit?: number;
  readonly cursor?: string;
}

/** Encode a cursor to the opaque string clients pass back as `page[next]`. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Decode an opaque client cursor back to a structured cursor. Throws on tampering. */
export function decodeCursor(raw: string): Cursor {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as Partial<Cursor>;
    if (typeof parsed.orderBy !== 'string' || typeof parsed.value !== 'string') {
      throw new Error('cursor missing fields');
    }
    return { orderBy: parsed.orderBy, value: parsed.value, id: parsed.id };
  } catch {
    throw new Error('Invalid pagination cursor');
  }
}

/**
 * Convenience: encode a cursor from the sort field + value + optional id
 * tiebreaker. Use this in repository cursor methods after fetching a page.
 */
export function toCursor(orderBy: string, value: string | number, id?: string): string {
  return encodeCursor({ orderBy, value: String(value), id });
}

/**
 * Resolve a client PageRequest into an effective limit (clamped to
 * [1, MAX_PAGE_SIZE], defaulting to DEFAULT_PAGE_SIZE) and a decoded cursor
 * (or undefined). Throws on a malformed cursor.
 */
export function resolvePageRequest(req: PageRequest): {
  limit: number;
  cursor: Cursor | undefined;
} {
  const rawLimit = req.limit ?? DEFAULT_PAGE_SIZE;
  const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(rawLimit)));
  const cursor = req.cursor ? decodeCursor(req.cursor) : undefined;
  return { limit, cursor };
}

/**
 * Build a `Page<T>` from a fetched rows array. Fetch `limit + 1` rows from the
 * DB; if the extra row exists, there is a next page and its cursor encodes the
 * last of the `limit` rows. Returns the trimmed `limit` rows.
 */
export function buildPage<T>(
  rows: readonly T[],
  limit: number,
  cursorFor: (lastRow: T) => string,
): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && data.length > 0 ? cursorFor(data[data.length - 1] as T) : null;
  return { data, nextCursor };
}
