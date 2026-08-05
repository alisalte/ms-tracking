/**
 * SessionId — the branded identity of a DeviceSession (06 §11.1).
 *
 * Stable for the life of one connection; a reconnect yields a new SessionId
 * (06 §6.1 invariant #3). UUIDv7 is the id strategy per the canonical
 * DeviceMessage spec (06 §9.2) — time-ordered, sortable, and unique across pods
 * without coordination. We generate it with the Web Crypto RNG + a ms timestamp,
 * which is sufficient for a v7-shaped unique id without a dependency.
 */
import { type Brand, asId } from '@fleetvision/shared-kernel';

/** Branded session identifier (string-backed UUID). */
export type SessionId = Brand<string, 'SessionId'>;

/** Brand a raw string as a SessionId (at trust boundaries / rehydration). */
export function asSessionId(value: string): SessionId {
  return asId(value, 'SessionId');
}

/**
 * Generate a new UUIDv7-shaped SessionId. RFC 9562 layout: 48-bit unix-ms
 * timestamp in the high bits, version nibble (0x7), 12 random bits, variant
 * bits (0b10), 62 random bits. Monotonic-ish per millisecond, globally unique.
 */
export function newSessionId(now: number = Date.now()): SessionId {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);

  // time_high (48 bits, ms) into bytes 0..5
  const view = new DataView(bytes.buffer);
  view.setUint32(0, Math.floor(now / 2 ** 16));
  view.setUint16(4, now & 0xffff);

  // version nibble
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  // variant bits
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  return asSessionId(toUuidString(bytes));
}

/** Render a 16-byte array as canonical 8-4-4-4-12 lowercase hex. */
function toUuidString(bytes: Uint8Array): string {
  const hex: string[] = [];
  for (const b of bytes) hex.push(b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}
