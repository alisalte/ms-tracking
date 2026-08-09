import { describe, expect, it } from 'vitest';

import {
  emailSchema,
  passwordSchema,
  passwordWithConfirmSchema,
  usernameSchema,
} from '@/lib/validation';

describe('Zod validation schemas', () => {
  // ── Email ──
  it('accepts valid emails', () => {
    expect(emailSchema.safeParse('user@example.com').success).toBe(true);
    expect(emailSchema.safeParse('a.b+c@domain.co').success).toBe(true);
  });

  it('rejects invalid emails', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    expect(emailSchema.safeParse('').success).toBe(false);
    expect(emailSchema.safeParse('missing@domain').success).toBe(false);
  });

  // ── Password ──
  it('accepts a strong password', () => {
    expect(passwordSchema.safeParse('ChangeMe!StrongPass123').success).toBe(true);
  });

  it('rejects passwords shorter than 12 chars', () => {
    expect(passwordSchema.safeParse('Short1!aA').success).toBe(false);
  });

  it('rejects passwords without lowercase', () => {
    expect(passwordSchema.safeParse('ALLUPPER123!A').success).toBe(false);
  });

  it('rejects passwords without uppercase', () => {
    expect(passwordSchema.safeParse('alllower123!a').success).toBe(false);
  });

  it('rejects passwords without a digit', () => {
    expect(passwordSchema.safeParse('NoDigits!!Ab').success).toBe(false);
  });

  it('rejects passwords without a symbol', () => {
    expect(passwordSchema.safeParse('NoSymbol123Ab').success).toBe(false);
  });

  // ── Username ──
  it('accepts valid usernames (3-64 chars)', () => {
    expect(usernameSchema.safeParse('abc').success).toBe(true);
    expect(usernameSchema.safeParse('john_doe42').success).toBe(true);
  });

  it('rejects usernames shorter than 3 chars', () => {
    expect(usernameSchema.safeParse('ab').success).toBe(false);
  });

  it('rejects usernames longer than 64 chars', () => {
    expect(usernameSchema.safeParse('a'.repeat(65)).success).toBe(false);
  });

  // ── Password + confirm ──
  it('passes when passwords match', () => {
    expect(
      passwordWithConfirmSchema.safeParse({
        password: 'Strong!Pass123',
        confirmPassword: 'Strong!Pass123',
      }).success,
    ).toBe(true);
  });

  it('fails when passwords do not match', () => {
    expect(
      passwordWithConfirmSchema.safeParse({
        password: 'Strong!Pass123',
        confirmPassword: 'Different!Pass456',
      }).success,
    ).toBe(false);
  });
});
