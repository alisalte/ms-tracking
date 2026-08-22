import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isRTL } from '@/i18n/config';

type ColorMode = 'light' | 'dark';
/** What the user chose — 'system' resolves against the OS preference. */
type ThemePreference = ColorMode | 'system';

interface ThemeContextValue {
  /** RESOLVED color mode ('light' | 'dark') — never 'system'. */
  mode: ColorMode;
  /** The stored user preference (may be 'system'). */
  preference: ThemePreference;
  toggleColorMode: () => void;
  setColorMode: (mode: ColorMode) => void;
  /** Set the preference explicitly ('light' | 'dark' | 'system'). */
  setPreference: (pref: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'light',
  preference: 'light',
  toggleColorMode: () => {},
  setColorMode: () => {},
  setPreference: () => {},
});

/**
 * Hook to access the theme context — allows toggling between light/dark mode.
 * `mode` is the resolved mode (system included); `preference` is what the user
 * picked in the theme switcher.
 */
export function useThemeContext(): ThemeContextValue {
  return useContext(ThemeContext);
}

/** Storage key for persisted theme preference. */
const THEME_STORAGE_KEY = 'fleetvision_theme_mode';

/**
 * Detect the initial preference:
 * 1. User's persisted preference (localStorage) — 'light' | 'dark' | 'system'
 * 2. Fallback to "light" — the reference UI is a light dashboard; dark mode
 *    remains fully supported via the switcher.
 */
function getInitialPreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
  return 'light';
}

/** Does the OS prefer dark? Safe in non-DOM/test environments (defaults light). */
function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

interface ThemeRegistryProps {
  children: ReactNode;
  defaultMode?: ColorMode;
}

/**
 * ThemeRegistry owns the app's color mode + document direction (Phase 2.5:
 * fully MUI-free — the Emotion/MUI ThemeProvider was removed with the last
 * MUI components; Tailwind preflight is the global reset now).
 *
 * 1. A small context for toggling color mode (persisted to localStorage)
 * 2. Mirrors the mode onto `<html class="dark">` (Tailwind class strategy)
 * 3. Keeps `<html lang>`/`<html dir>` in sync with the active i18next language
 *    (UI_UX_Design.md §0.9) — RTL languages flip the document, and all layout
 *    uses Tailwind logical utilities (ps/pe/ms/me) so no CSS-JS mirroring is
 *    needed.
 */
export function ThemeRegistry({ children, defaultMode }: ThemeRegistryProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    defaultMode ?? getInitialPreference,
  );
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);
  const { i18n } = useTranslation();
  const language = i18n.language;
  const direction = isRTL(language) ? 'rtl' : 'ltr';

  // Follow the OS color scheme while the preference is 'system' (Phase 2:
  // light / dark / system with persistence). Safe no-op where matchMedia is
  // unavailable (jsdom without a mock, SSR).
  useEffect(() => {
    if (preference !== 'system' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(query.matches);
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, [preference]);

  // Resolve the effective color mode: the explicit preference, or the OS
  // scheme when the user chose 'system'.
  const mode: ColorMode = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  // Keep <html lang> and <html dir> in sync with the active language so the
  // browser, screen readers, and every layout utility honor the direction.
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = direction;
  }, [language, direction]);

  // Tailwind `dark:` variant strategy — one class on <html>.
  useEffect(() => {
    const root = document.documentElement;
    if (mode === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
  }, [mode]);

  const themeContextValue = useMemo(
    (): ThemeContextValue => ({
      mode,
      preference,
      toggleColorMode: () => {
        // Toggling pins the theme to the explicit opposite of the RESOLVED
        // mode (so toggling out of "system: dark" lands on explicit light).
        const next: ColorMode = mode === 'light' ? 'dark' : 'light';
        localStorage.setItem(THEME_STORAGE_KEY, next);
        setPreferenceState(next);
      },
      setColorMode: (newMode: ColorMode) => {
        localStorage.setItem(THEME_STORAGE_KEY, newMode);
        setPreferenceState(newMode);
      },
      setPreference: (pref: ThemePreference) => {
        localStorage.setItem(THEME_STORAGE_KEY, pref);
        setPreferenceState(pref);
      },
    }),
    [mode, preference],
  );

  return <ThemeContext.Provider value={themeContextValue}>{children}</ThemeContext.Provider>;
}
