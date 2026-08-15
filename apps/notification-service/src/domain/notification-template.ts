/**
 * Safe notification template interpolation (Sprint H §26).
 *
 * Templates use `{{key}}` placeholders replaced from a whitelisted,
 * server-side data map. The mechanism is plain string replacement —
 * NO executable template code (no eval, no Function, no handlebars
 * partials). Unknown placeholders are removed; values are stringified
 * and never interpreted.
 */

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Whitelisted template data keys (Sprint H §28). Only these keys may be
 * interpolated into notification titles/bodies — secrets, JWTs, API keys
 * and internal identifiers beyond this list must never enter templates.
 */
export const TEMPLATE_DATA_KEYS = [
  'vehicleName',
  'vehicleId',
  'eventType',
  'speed',
  'speedLimit',
  'geofenceName',
  'occurredAt',
  'address',
  'driverName',
  'duration',
  'batteryLevel',
] as const;

export type TemplateDataKey = (typeof TEMPLATE_DATA_KEYS)[number];
export type TemplateData = Partial<Record<TemplateDataKey, string | number>>;

/** Render a template string by replacing {{key}} placeholders. */
export function renderTemplate(template: string, data: TemplateData): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, key: string) => {
    const value = (data as Record<string, string | number | undefined>)[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

/** Strip unresolvable placeholders — used to validate template definitions. */
export function templateKeys(template: string): string[] {
  const keys: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    if (match[1]) keys.push(match[1]);
  }
  return keys;
}
