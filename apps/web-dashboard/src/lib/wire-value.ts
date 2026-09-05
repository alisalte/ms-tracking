/**
 * Read a Nest/JSON payload that may use camelCase (class serialization) or
 * snake_case (row/DTO) keys. Never invent a timestamp when the field is absent.
 */

export function wireValue(raw: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = raw[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

export function wireStr(raw: Record<string, unknown>, ...keys: string[]): string {
  const value = wireValue(raw, ...keys);
  if (value == null) return '';
  const text = String(value).trim();
  return text;
}

export function wireNum(raw: Record<string, unknown>, ...keys: string[]): number {
  const value = wireValue(raw, ...keys);
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function wireIso(raw: Record<string, unknown>, ...keys: string[]): string | undefined {
  const value = wireValue(raw, ...keys);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return undefined;
}
