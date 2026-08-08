import { z } from 'zod';

/**
 * Shared zod validation schemas for identity forms.
 *
 * Password rules encode the FleetVision Security policy
 * (`docs/modules/Authentication.md` AUTH-BR-01, and IAM config
 * `password.min-length: 12`, require-uppercase/lowercase/digit/special):
 * ≥ 12 chars, mixed case, a digit, and a symbol. The schemas are reused across
 * register, reset-password, and (future) change-password forms.
 *
 * NOTE: client-side validation mirrors the documented policy; the backend
 * remains the source of truth (it also checks breach corpus + history).
 */

/** Minimum password length per AUTH-BR-01. */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * Password schema with granular, i18n-key-free messages.
 * Components map these to translated strings via `t('validation.<rule>')`;
 * the zod message is a stable machine key used as a fallback.
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { message: 'validation.password.tooShort' })
  .regex(/[a-z]/, { message: 'validation.password.lowercase' })
  .regex(/[A-Z]/, { message: 'validation.password.uppercase' })
  .regex(/[0-9]/, { message: 'validation.password.digit' })
  .regex(/[^a-zA-Z0-9]/, { message: 'validation.password.symbol' });

/** Email schema (RFC-ish; the backend lowercases + trims). */
export const emailSchema = z
  .string()
  .trim()
  .min(1, { message: 'validation.email.required' })
  .email({ message: 'validation.email.invalid' });

/** Username: 3–64 chars (matches the backend `createUserSchema`). */
export const usernameSchema = z
  .string()
  .trim()
  .min(3, { message: 'validation.username.tooShort' })
  .max(64, { message: 'validation.username.tooLong' });

/** Display name: optional, max 128 (matches the backend schema). */
export const displayNameSchema = z
  .string()
  .trim()
  .max(128, { message: 'validation.displayName.tooLong' })
  .optional();

/**
 * Password + confirmation pair. Validates that the two fields match and
 * returns the single `password` value on success.
 */
export const passwordWithConfirmSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'validation.password.mismatch',
    path: ['confirmPassword'],
  });
