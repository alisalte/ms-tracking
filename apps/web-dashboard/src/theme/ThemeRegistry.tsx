import { CacheProvider } from '@emotion/react';
import { CssBaseline, type Theme, ThemeProvider } from '@mui/material';
import { createTheme } from '@mui/material/styles';
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isRTL } from '@/i18n/config';
import { darkTheme } from './dark.theme';
import { getRtlCache } from './rtl';
import { fontStackFor, lightTheme } from './theme';

type ColorMode = 'light' | 'dark';

interface ThemeContextValue {
  mode: ColorMode;
  toggleColorMode: () => void;
  setColorMode: (mode: ColorMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'light',
  toggleColorMode: () => {},
  setColorMode: () => {},
});

/**
 * Hook to access the theme context — allows toggling between light/dark mode.
 */
export function useThemeContext(): ThemeContextValue {
  return useContext(ThemeContext);
}

/** Storage key for persisted theme preference. */
const THEME_STORAGE_KEY = 'fleetvision_theme_mode';

/**
 * Detect the initial color mode:
 * 1. User's persisted preference (localStorage)
 * 2. Fallback to "light" — the Limitless Layout 1 reference is a light UI
 *    (light navbar, #f5f5f5 content, white cards). Dark mode remains fully
 *    supported via the toggle. (v3 redesign.)
 */
function getInitialMode(): ColorMode {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return 'light';
}

interface ThemeRegistryProps {
  children: ReactNode;
  defaultMode?: ColorMode;
}

/**
 * ThemeRegistry wraps the app with:
 * 1. Emotion `CacheProvider` — direction-aware cache (RTL flips styles)
 * 2. MUI `ThemeProvider` + `CssBaseline` — light/dark theme with `direction`
 * 3. A small context for toggling color mode (persisted to localStorage)
 *
 * Direction is derived from the active i18next language (UI_UX_Design.md §0.9):
 * RTL languages (fa/he/ar) flip both the MUI theme direction and the
 * `<html dir>` attribute.
 */
export function ThemeRegistry({ children, defaultMode }: ThemeRegistryProps) {
  const [mode, setMode] = useState<ColorMode>(defaultMode ?? getInitialMode);
  const { i18n } = useTranslation();
  const language = i18n.language;
  const direction = isRTL(language) ? 'rtl' : 'ltr';

  // Keep <html lang> and <html dir> in sync with the active language so the
  // browser, screen readers, and any non-MUI markup honor the text direction.
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = direction;
  }, [language, direction]);

  // Mirror the color mode onto <html class="dark"> so Tailwind's `dark:`
  // variant tracks the same toggle that drives the MUI theme swap. One switch
  // governs both systems (TailAdmin-style class strategy + MUI ThemeProvider).
  useEffect(() => {
    const root = document.documentElement;
    if (mode === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
  }, [mode]);

  const theme = useMemo((): Theme => {
    // Recreate the base theme so direction + the direction-aware font stack are
    // baked in. In RTL the body font becomes Vazirmatn (Persian) so MUI/Emotion
    // applies it to every component — the `global.css` rule alone is overridden
    // by MUI's per-component injected styles.
    const base = mode === 'dark' ? darkTheme : lightTheme;
    return createTheme(base, {
      direction,
      typography: { fontFamily: fontStackFor(direction) },
    });
  }, [mode, direction]);

  const emotionCache = useMemo(() => getRtlCache(direction), [direction]);

  const themeContextValue = useMemo(
    (): ThemeContextValue => ({
      mode,
      toggleColorMode: () => {
        setMode((prev) => {
          const next = prev === 'light' ? 'dark' : 'light';
          localStorage.setItem(THEME_STORAGE_KEY, next);
          return next;
        });
      },
      setColorMode: (newMode: ColorMode) => {
        localStorage.setItem(THEME_STORAGE_KEY, newMode);
        setMode(newMode);
      },
    }),
    [mode],
  );

  return (
    <ThemeContext.Provider value={themeContextValue}>
      <CacheProvider value={emotionCache}>
        <ThemeProvider theme={theme}>
          <CssBaseline enableColorScheme />
          {children}
        </ThemeProvider>
      </CacheProvider>
    </ThemeContext.Provider>
  );
}
