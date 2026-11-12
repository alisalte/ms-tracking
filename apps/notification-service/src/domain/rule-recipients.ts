/**
 * Rule email recipients — extra addresses an alarm rule emails when it fires.
 * Same contract as reporting-service's `normalizeRecipients` (schedules).
 */
export const MAX_RULE_RECIPIENTS = 10;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim, lowercase, dedupe; returns null if any address is invalid or the list is too long. */
export function normalizeRecipients(input: readonly string[]): string[] | null {
  const out: string[] = [];
  for (const raw of input) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    if (email.length > 254 || !EMAIL_RE.test(email)) return null;
    if (!out.includes(email)) out.push(email);
  }
  return out.length > MAX_RULE_RECIPIENTS ? null : out;
}
