/**
 * Pagination primitives — cursor-based, matching API_Design.md §2.1.
 * Cursor pagination is required on every collection endpoint (no offset paging),
 * because offset paging degrades catastrophically on high-write time-series data.
 */

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
    return { orderBy: parsed.orderBy, value: parsed.value };
  } catch {
    throw new Error('Invalid pagination cursor');
  }
}
