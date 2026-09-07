/** Derive a short display name from an email local-part (e.g. ali.m → Ali.m). */
export function headingFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  if (!local) return email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/** First role, humanized. Unknown roles keep their identifier. */
export function primaryRoleLabel(roles: readonly string[] | undefined, fallback: string): string {
  const role = roles?.[0];
  if (!role) return fallback;
  if (role === '*') return fallback;
  return role.replace(/[._-]+/g, ' ');
}
