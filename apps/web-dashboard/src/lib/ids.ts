/**
 * UUID vs human-label helpers. Internal ids stay in keys/routes/API params;
 * the UI never presents a raw GUID when a title exists, and hides the GUID
 * when it does not.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): boolean {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

/**
 * Prefer a non-UUID `id` as-is. If `id` is a GUID, use `title` when it is a
 * human string. Returns `null` when the only available value is a GUID.
 */
export function displayLabel(id: string | null | undefined, title?: string | null): string | null {
  const raw = id?.trim();
  if (raw && !isUuid(raw)) return raw;
  const named = title?.trim();
  if (named && !isUuid(named)) return named;
  return null;
}
