import { useEffect, useState } from 'react';

/** Tailwind `md` breakpoint as a max-width query: true on phones. */
export const PHONE_QUERY = '(max-width: 767.98px)';

/**
 * Subscribe to a CSS media query. Falls back to `false` where `matchMedia` is
 * unavailable (jsdom, SSR) so desktop layouts stay the default.
 */
export function useMediaQuery(query: string): boolean {
  const get = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;
  const [matches, setMatches] = useState(get);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, [query]);

  return matches;
}

/** True on phone-width viewports (< 768px). */
export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}
