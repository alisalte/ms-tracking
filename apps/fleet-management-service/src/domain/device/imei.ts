/**
 * IMEI — International Mobile Equipment Identity (3GPP TS 23.003), the critical
 * physical-identity field a tracking device sends on LOGIN.
 *
 * Sprint C §10 requirements: normalized, validated, indexed, uniqueness enforced.
 *
 * - Normalized: stripped to its 15 decimal digits (whitespace/dashes/separators
 *   removed), so `"35-123456-789012-4"` and `"351234567890124"` collapse to one
 *   canonical key and the global unique index is not defeated by formatting.
 * - Validated: 15 digits with a correct Luhn check digit (the form GT06/JT808/
 *   Meitrack devices transmit). IMEISV (16 digits, no Luhn) is rejected as out of
 *   scope for this sprint's device population.
 *
 * IMEI is GLOBALLY unique (not tenant-scoped): the device-gateway resolves IMEI →
 * device CROSS-tenant, before the owning tenant is known. Documented in the
 * Sprint C report and enforced by the `fleet.devices_imei_unique` index.
 */

/** A normalized, validated IMEI (15 digits, Luhn-correct). Brand it for safety. */
export type Imei = string & { readonly __brand: 'Imei' };

/** Strip an IMEI to its 15 decimal digits. Does NOT validate — use isValidImei. */
export function normalizeImei(input: string): string {
  return input.replace(/\D/g, '');
}

/** Standard IMEI length (15 digits). */
export const IMEI_LENGTH = 15;

/** True iff `input` normalizes to 15 digits with a valid Luhn check digit. */
export function isValidImei(input: string): boolean {
  const digits = normalizeImei(input);
  if (digits.length !== IMEI_LENGTH) return false;
  return luhnValid(digits);
}

/**
 * Parse + validate an IMEI. Throws on an invalid value so callers can't build a
 * Device around a malformed identity (defense in depth alongside the zod schema
 * and the DB unique constraint).
 */
export function imei(input: string): Imei {
  const digits = normalizeImei(input);
  if (!luhnValid(digits) || digits.length !== IMEI_LENGTH) {
    throw new Error(`Invalid IMEI: must be ${IMEI_LENGTH} digits with a valid Luhn check digit.`);
  }
  return digits as Imei;
}

/** Luhn algorithm check (ISO/IEC 7812-1) — the IMEI check digit is Luhn. */
function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let shouldDouble = false;
  // Walk right→left; the last digit is the check digit (not doubled).
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (shouldDouble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}
