import { describe, expect, it } from '@jest/globals';
import { assertPasswordPolicy, checkPasswordPolicy } from '../domain/password-policy.js';

describe('password policy', () => {
  const cfg = { minLength: 12 };

  it('accepts a strong password', () => {
    expect(checkPasswordPolicy('StrongPass123!', cfg).ok).toBe(true);
    expect(() => assertPasswordPolicy('StrongPass123!', cfg)).not.toThrow();
  });

  it('rejects too-short passwords', () => {
    expect(checkPasswordPolicy('Short1!', cfg).ok).toBe(false);
  });

  it('rejects missing uppercase', () => {
    expect(checkPasswordPolicy('alllowercase123!', cfg).ok).toBe(false);
  });

  it('rejects missing lowercase', () => {
    expect(checkPasswordPolicy('ALLUPPERCASE123!', cfg).ok).toBe(false);
  });

  it('rejects missing digit', () => {
    expect(checkPasswordPolicy('NoDigitsHere!', cfg).ok).toBe(false);
  });

  it('rejects missing special character', () => {
    expect(checkPasswordPolicy('NoSpecial123', cfg).ok).toBe(false);
  });

  it('throws a PasswordPolicyError with a reason', () => {
    expect(() => assertPasswordPolicy('weak', cfg)).toThrow(/at least 12 characters/);
  });
});
