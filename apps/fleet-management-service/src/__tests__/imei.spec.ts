import { describe, expect, it } from '@jest/globals';
import { IMEI_LENGTH, imei, isValidImei, normalizeImei } from '../domain/device/imei.js';

/** Compute the correct Luhn check digit for a 14-digit prefix (test helper). */
function withCheckDigit(first14: string): string {
  let sum = 0;
  let double = true; // rightmost of the prefix is at position 2 → doubled
  for (let i = first14.length - 1; i >= 0; i--) {
    let d = first14.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return `${first14}${(10 - (sum % 10)) % 10}`;
}

describe('IMEI value object (§10)', () => {
  const valid = withCheckDigit('35123456789012');

  it('normalizes away non-digit separators', () => {
    expect(normalizeImei('35-123 456 789012')).toBe('35123456789012');
    expect(normalizeImei('  351234567890124\n')).toBe('351234567890124');
  });

  it('accepts a Luhn-correct 15-digit IMEI', () => {
    expect(valid.length).toBe(IMEI_LENGTH);
    expect(isValidImei(valid)).toBe(true);
  });

  it('accepts the same IMEI regardless of formatting (normalized → one canonical key)', () => {
    expect(isValidImei(`35-123-456-789012-${valid.slice(-1)}`)).toBe(true);
  });

  it('rejects wrong-length input', () => {
    expect(isValidImei('351234567890')).toBe(false); // too short
    expect(isValidImei('3512345678901245')).toBe(false); // 16 digits (IMEISV not supported)
  });

  it('rejects a bad Luhn check digit', () => {
    const tampered = `${valid.slice(0, 14)}${valid.slice(-1) === '0' ? '1' : '0'}`;
    expect(isValidImei(tampered)).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(isValidImei('abcdefghijklmno')).toBe(false);
  });

  it('imei() parses + normalizes a valid value and brands it', () => {
    const parsed = imei(`  ${valid} `);
    expect(parsed).toBe(valid);
  });

  it('imei() throws on an invalid value', () => {
    expect(() => imei('not-an-imei')).toThrow();
  });
});
