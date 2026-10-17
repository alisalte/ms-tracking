/**
 * Canonical mailbox form. Storage and login both use this so a user created as
 * `Ali@Example.com` signs in as `ali@example.com`.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
