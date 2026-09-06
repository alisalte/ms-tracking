/** One year — map chrome prefs should survive restarts and logins. */
const PREF_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365;

function cookiePair(name: string): string {
  return `${encodeURIComponent(name)}=`;
}

/** Read a first-party preference cookie (not HttpOnly). */
export function readPrefCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = cookiePair(name);
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}

/** Persist a preference cookie at `/` so every dashboard route can read it. */
export function writePrefCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return;
  const secure =
    typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${cookiePair(name)}${encodeURIComponent(value)}; Path=/; Max-Age=${PREF_COOKIE_MAX_AGE_SEC}; SameSite=Lax${secure}`;
}

export function clearPrefCookie(name: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${cookiePair(name)}; Path=/; Max-Age=0; SameSite=Lax`;
}
