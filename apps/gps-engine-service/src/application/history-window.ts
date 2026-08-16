/**
 * History window parsing (Sprint I §29/§30) — pure + unit-testable.
 *
 * `GET /positions/:vehicleId` accepts EITHER:
 *   - `preset=1h|6h|24h|7d` — server-side preset window ending at `now`
 *     (matching the Sprint F client-side presets), OR
 *   - `from` + `to` — a CUSTOM ISO date/time range.
 *
 * Providing BOTH is an ambiguous request → 400 (never silently prefer one).
 * Validation: valid ISO timestamps, from < to, duration ≤ maxRangeDays
 * (the documented Sprint F 31-day bound, configurable via
 * HISTORY_MAX_RANGE_DAYS — never silently increased).
 */

export const HISTORY_PRESETS = {
  '1h': 3_600_000,
  '6h': 21_600_000,
  '24h': 86_400_000,
  '7d': 604_800_000,
  '30d': 2_592_000_000,
} as const;

export type HistoryPreset = keyof typeof HISTORY_PRESETS;

export type HistoryWindow = { fromTime: Date; toTime: Date };

export type HistoryWindowError =
  | 'AMBIGUOUS'
  | 'UNKNOWN_PRESET'
  | 'INVALID_ISO'
  | 'REVERSED'
  | 'RANGE_TOO_LARGE';

/**
 * Parse the query into a validated window. Returns `{ error }` on invalid
 * input (the controller maps it to a controlled 400) or `{ window }`.
 */
export function parseHistoryWindow(input: {
  preset?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  now?: Date;
  maxRangeDays?: number;
}):
  | { window: HistoryWindow; error?: undefined }
  | { error: HistoryWindowError; window?: undefined } {
  const now = input.now ?? new Date();
  const maxRangeDays = input.maxRangeDays ?? 31;
  const maxRangeMs = maxRangeDays * 86_400_000;
  const preset = input.preset?.trim() || undefined;
  const hasFromTo = input.from !== undefined || input.to !== undefined;

  if (preset && hasFromTo) {
    // Sprint I §30 — never allow both to produce ambiguous behavior.
    return { error: 'AMBIGUOUS' };
  }

  if (preset) {
    const span = HISTORY_PRESETS[preset as HistoryPreset];
    if (span === undefined) {
      return { error: 'UNKNOWN_PRESET' };
    }
    return { window: { fromTime: new Date(now.getTime() - span), toTime: now } };
  }

  const fromTime =
    input.from !== undefined ? new Date(input.from) : new Date(now.getTime() - 86_400_000);
  const toTime = input.to !== undefined ? new Date(input.to) : now;
  if (Number.isNaN(fromTime.getTime()) || Number.isNaN(toTime.getTime())) {
    return { error: 'INVALID_ISO' };
  }
  if (fromTime >= toTime) {
    return { error: 'REVERSED' };
  }
  if (toTime.getTime() - fromTime.getTime() > maxRangeMs) {
    return { error: 'RANGE_TOO_LARGE' };
  }
  return { window: { fromTime, toTime } };
}

/** HTTP status message per error kind (controlled 4xx — no stack traces). */
export function historyWindowErrorMessage(error: HistoryWindowError, maxRangeDays: number): string {
  switch (error) {
    case 'AMBIGUOUS':
      return 'Provide either preset or from/to — not both';
    case 'UNKNOWN_PRESET':
      return `preset must be one of ${Object.keys(HISTORY_PRESETS).join('|')}`;
    case 'INVALID_ISO':
      return 'from/to must be valid ISO timestamps';
    case 'REVERSED':
      return 'from must be before to';
    case 'RANGE_TOO_LARGE':
      return `Time range too large (max ${maxRangeDays} days)`;
  }
}
