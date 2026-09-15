/**
 * Human-readable device / dispatch failures.
 *
 * A failed `DeviceCommandRecord` carries a machine string in `error`: either a
 * dispatcher verdict (`TTL_EXPIRED`, `DEVICE_OFFLINE`, …) or the device's own
 * reply prefixed by the ack consumer as `DEVICE_ERROR:<payload>` (see
 * fleet-management `command-ack-consumer.ts`). Meitrack units answer a rejected
 * command with a `FFFx` hex code — an MD300 replies `CD1,FFFE` to a DMS
 * calibration request, for example — which is meaningless to an operator.
 *
 * `describeDeviceError` maps the string onto an i18n key under
 * `deviceError.*` and keeps the raw code so the original stays visible for
 * support. Anything unrecognised falls through as `unknown` with the raw text.
 */

/** One decoded failure: an i18n key plus the raw code it came from. */
export interface DeviceErrorDescription {
  /** Key suffix under `deviceError.` — e.g. `rejected` → `deviceError.rejected`. */
  readonly key: string;
  /** Raw protocol code shown alongside the sentence (`FFFE`, `TTL_EXPIRED`, …). */
  readonly code: string;
  /** True when the device itself answered (vs. never reaching it). */
  readonly fromDevice: boolean;
}

/** Dispatcher / lifecycle verdicts — the command never got a device answer. */
const DISPATCH_KEYS: Record<string, string> = {
  TTL_EXPIRED: 'noReply',
  DEVICE_OFFLINE: 'offline',
  DEVICE_NOT_AUTHENTICATED: 'notAuthenticated',
  ENCODE_FAILED: 'encodeFailed',
};

/** Device reply payloads we can name. Checked case-insensitively. */
const DEVICE_PAYLOAD_KEYS: ReadonlyArray<readonly [RegExp, string]> = [
  // FFF5 = the unit has no file for the requested window (AB8/D01 listings).
  [/^fff5$/i, 'noFile'],
  // Other FFFx codes are the unit refusing the command outright.
  [/^fff[0-9a-f]{1,2}$/i, 'rejected'],
  [/^not support/i, 'unsupported'],
  [/^(error|fail|failed|err)\b/i, 'deviceError'],
];

/**
 * Decode a command failure string. Returns `null` for an empty input so callers
 * can fall back to their own generic copy.
 */
export function describeDeviceError(raw: string | null | undefined): DeviceErrorDescription | null {
  const text = (raw ?? '').trim();
  if (!text) return null;

  const deviceMatch = /^DEVICE_ERROR:(.*)$/is.exec(text);
  if (deviceMatch) {
    const payload = (deviceMatch[1] ?? '').trim();
    const code = payload || 'DEVICE_ERROR';
    for (const [pattern, key] of DEVICE_PAYLOAD_KEYS) {
      if (pattern.test(payload)) return { key, code, fromDevice: true };
    }
    return { key: 'unknownDevice', code, fromDevice: true };
  }

  const dispatchKey = DISPATCH_KEYS[text.toUpperCase()];
  if (dispatchKey) return { key: dispatchKey, code: text, fromDevice: false };

  if (/^ADAPTER_NOT_FOUND:/i.test(text)) {
    return { key: 'adapterMissing', code: text, fromDevice: false };
  }

  return { key: 'unknown', code: text, fromDevice: false };
}

/** A command row's reply, ready to render. */
export interface CommandReply {
  /** Operator-facing text: a named failure, or the device's own reply payload. */
  readonly text: string;
  /** Raw protocol string, when it differs from `text` — tooltip / secondary line. */
  readonly raw: string | null;
  readonly isError: boolean;
}

/** The subset of a command record this module reads. */
interface ReplyRow {
  readonly responseText?: string | null;
  readonly error?: string | null;
}

/**
 * Localized reply text for one command row.
 *
 * A failed row is named through `deviceError.*` and keeps its raw protocol
 * string (`CD1,FFFE`) as secondary text; a successful row keeps the device's
 * own payload verbatim, which is already meaningful (`AB2,OK`).
 */
export function commandReply(
  t: (key: string, options?: Record<string, unknown>) => string,
  row: ReplyRow,
): CommandReply {
  const failure = describeDeviceError(row.error);
  if (failure) {
    return {
      text: t(`deviceError.${failure.key}`),
      raw: row.responseText || failure.code,
      isError: true,
    };
  }
  const response = (row.responseText ?? '').trim();
  return { text: response || '—', raw: null, isError: false };
}
