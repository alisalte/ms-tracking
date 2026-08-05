/**
 * W3C Trace Context `traceparent` header helpers.
 * Format: `00-<trace-id(32hex)>-<span-id(16hex)>-<flags(2hex)>`
 * (https://www.w3.org/TR/trace-context/)
 *
 * Sprint 1 generates a synthetic traceparent per inbound request when one is
 * absent, so every log line is correlatable even before the OTel SDK is wired
 * (Sprint 2 will replace these with the real OTel context).
 */
const HEX = '0123456789abcdef';
const TRACE_ID_LEN = 32;
const SPAN_ID_LEN = 16;

function randomHex(length: number): string {
  const bytes = new Uint8Array(length / 2);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) {
    const hi = HEX[b >> 4];
    const lo = HEX[b & 0x0f];
    // HEX is a fixed 16-char literal; both nibbles are always in range.
    out += (hi ?? '?') + (lo ?? '?');
  }
  return out;
}

/** Generate a fresh, spec-compliant traceparent (trace-id must not be all zeros). */
export function generateTraceparent(): string {
  let traceId = randomHex(TRACE_ID_LEN);
  // trace-id of all zeros is invalid per spec; re-roll if it happens.
  if (traceId === '0'.repeat(TRACE_ID_LEN)) {
    traceId = randomHex(TRACE_ID_LEN);
  }
  const spanId = randomHex(SPAN_ID_LEN);
  return `00-${traceId}-${spanId}-01`;
}

/** Parse a traceparent into its parts; returns null if malformed. */
export function parseTraceparent(
  header: string,
): { traceId: string; spanId: string; flags: string } | null {
  const parts = header.split('-');
  if (parts.length !== 4) return null;
  const traceId = parts[1];
  const spanId = parts[2];
  const flags = parts[3];
  // parts.length === 4 guarantees indices 1–3 are present, but
  // noUncheckedIndexedAccess types them as `string | undefined`; narrow here.
  if (traceId === undefined || spanId === undefined || flags === undefined) {
    return null;
  }
  if (traceId.length !== TRACE_ID_LEN || spanId.length !== SPAN_ID_LEN || flags.length !== 2) {
    return null;
  }
  if (!/^[0-9a-f]+$/.test(traceId) || !/^[0-9a-f]+$/.test(spanId) || !/^[0-9a-f]+$/.test(flags)) {
    return null;
  }
  return { traceId, spanId, flags };
}
