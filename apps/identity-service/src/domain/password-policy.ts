/**
 * Password policy value object — validates a plaintext password against the
 * configured policy (length + complexity) before hashing. The hash itself is
 * produced by the PasswordHasher (argon2id); this VO only enforces the policy.
 *
 * Policy: docs/modules/Identity-Access-Management.md §8 — min length 12,
 * upper/lower/digit/special. The configured min length is passed in so the
 * policy is env-driven (PASSWORD_MIN_LENGTH).
 */
import { PasswordPolicyError } from './errors.js';

export interface PasswordPolicyConfig {
  readonly minLength: number;
}

export interface PasswordCheckResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/** Validate a plaintext password against the policy (does not hash). */
export function checkPasswordPolicy(
  password: string,
  config: PasswordPolicyConfig,
): PasswordCheckResult {
  if (password.length < config.minLength) {
    return { ok: false, reason: `Password must be at least ${config.minLength} characters.` };
  }
  if (!/[A-Z]/.test(password)) {
    return { ok: false, reason: 'Password must contain an uppercase letter.' };
  }
  if (!/[a-z]/.test(password)) {
    return { ok: false, reason: 'Password must contain a lowercase letter.' };
  }
  if (!/[0-9]/.test(password)) {
    return { ok: false, reason: 'Password must contain a digit.' };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { ok: false, reason: 'Password must contain a special character.' };
  }
  return { ok: true };
}

/** Assert the policy, throwing a PasswordPolicyError on violation. */
export function assertPasswordPolicy(password: string, config: PasswordPolicyConfig): void {
  const result = checkPasswordPolicy(password, config);
  if (!result.ok) {
    throw new PasswordPolicyError(result.reason ?? 'Password does not meet the policy.');
  }
}
