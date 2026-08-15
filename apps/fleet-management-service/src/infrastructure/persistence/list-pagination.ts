/**
 * Cursor pagination helper — every fleet list endpoint paginates this way
 * (shared-kernel's mandated standard: "cursor pagination is required on every
 * collection endpoint, no offset paging" — §15). Wraps `encodeCursor`/`decodeCursor`
 * (tamper-proof, base64url) over a stable (created_at, id) composite key.
 *
 * Usage: build a tenant-scoped, filtered base query, then `listPaginated(base, …)`
 * adds the ordering + cursor predicate + limit and returns a `Page<T>`.
 */
import type { Knex } from '@fleetvision/persistence-knex';
import { type Page, decodeCursor, encodeCursor } from '@fleetvision/shared-kernel';

export interface CreatedAtIdRow {
  readonly created_at: string | Date;
  readonly id: string;
}

/** Encode the last row's (created_at, id) into the opaque client cursor. */
function encodeListCursor(row: CreatedAtIdRow): string {
  const iso = new Date(row.created_at).toISOString();
  return encodeCursor({ orderBy: 'created_at,id', value: `${iso}|${row.id}` });
}

/** Decode a client cursor back to {createdAt, id}; throws on tampering. */
function decodeListCursor(raw: string): { createdAt: Date; id: string } {
  const c = decodeCursor(raw);
  const [iso, id] = c.value.split('|');
  if (!iso || !id) throw new Error('Invalid pagination cursor');
  return { createdAt: new Date(iso), id };
}

/**
 * Apply ordering + cursor + limit to a base query and return a Page. Fetches
 * `limit + 1` rows to detect whether another page exists, then trims.
 */
export async function listPaginated<T extends CreatedAtIdRow>(
  base: Knex.QueryBuilder,
  opts: { readonly cursor?: string; readonly limit: number },
): Promise<Page<T>> {
  let query = base.clone().orderBy('created_at', 'asc').orderBy('id', 'asc');
  if (opts.cursor) {
    const { createdAt, id } = decodeListCursor(opts.cursor);
    // Compare on milliseconds: the cursor carries a JS-Date (ms precision) but PG
    // timestamptz stores microseconds, so a row sharing the cursor's millisecond
    // would otherwise reappear on the next page. date_trunc('milliseconds', …)
    // aligns the column to the cursor's precision before the composite compare.
    query = query.whereRaw(
      "(date_trunc('milliseconds', created_at) > ? OR (date_trunc('milliseconds', created_at) = ? AND id > ?))",
      [createdAt, createdAt, id],
    );
  }
  const rows = (await query.limit(opts.limit + 1)) as unknown as T[];
  const hasMore = rows.length > opts.limit;
  const data = hasMore ? rows.slice(0, opts.limit) : rows;
  const last = data[data.length - 1];
  const nextCursor = hasMore && last ? encodeListCursor(last) : null;
  return { data, nextCursor };
}
