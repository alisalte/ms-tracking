/**
 * Spreadsheet lookup helpers — Excel cells often carry NBSP, RTL marks, or
 * Unicode dashes that look identical to ASCII `FLEET-01` in the UI.
 */

const INVISIBLE = /[\u200B\u200C\uFEFF\u2060\u00A0\u200E\u200F\u202A-\u202E]|\u200D/g;
const DASHES = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;

/** Strip Excel/RTL junk and fold Unicode dashes to ASCII hyphen. */
export function sanitizeSpreadsheetText(raw: string): string {
  return raw.normalize('NFKC').replace(INVISIBLE, '').replace(DASHES, '-').trim();
}

/**
 * Registry code (`[A-Za-z0-9_-]`, 1–64). Spaces become hyphens so `FLEET 01`
 * still maps to `FLEET-01`.
 */
export function toAssetCode(raw: string): string | null {
  const s = sanitizeSpreadsheetText(raw).replace(/\s+/g, '-');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) return null;
  return s;
}

/** Keys used to match a typed Excel value against stored code/name. */
export function lookupKeys(raw: string): string[] {
  const cleaned = sanitizeSpreadsheetText(raw);
  const lower = cleaned.toLowerCase();
  const compact = lower.replace(/[-_\s]+/g, '');
  return [...new Set([lower, compact].filter((s) => s.length > 0))];
}

export function indexByLookup<T>(
  rows: readonly T[],
  keysOf: (row: T) => string[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    for (const key of keysOf(row)) {
      const arr = map.get(key) ?? [];
      if (!arr.includes(row)) arr.push(row);
      map.set(key, arr);
    }
  }
  return map;
}

export function matchIndexed<T>(index: Map<string, T[]>, raw: string): T | null {
  for (const key of lookupKeys(raw)) {
    const hits = index.get(key);
    if (hits?.length === 1) return hits[0] ?? null;
  }
  return null;
}
