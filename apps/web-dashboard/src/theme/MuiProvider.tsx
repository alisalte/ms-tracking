import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { prefixer } from 'stylis';
import rtlPlugin from 'stylis-plugin-rtl';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useThemeContext } from '@/theme/ThemeRegistry';

/**
 * MuiProvider — bridges the app's existing design tokens into MUI so the
 * Material-styled surfaces (map side panels) stay on-brand:
 *
 * - palette.mode mirrors the ThemeRegistry color mode (the Tailwind `dark`
 *   class and MUI dark surfaces move together);
 * - primary follows the Tailwind brand ramp (#465ffb / #3641f5 / #2d31d4);
 * - paper/defaults follow the graydark surfaces used across the app;
 * - direction follows the active i18n language; in RTL an emotion cache with
 *   the stylis RTL plugin flips MUI's physical properties (margins, paddings,
 *   positions) so Persian renders correctly;
 * - no CssBaseline — global resets stay owned by the Tailwind layer.
 *
 * The two caches are created once at module scope: recreating an emotion
 * cache per render would remount all serialized styles.
 */

// Brand ramp (src/styles/tailwind.css) + dark surfaces (graydark-*).
const BRAND = { 500: '#465ffb', 600: '#3641f5', 700: '#2d31d4' };
const DARK = { paper: '#333a48', elevated: '#3d4452', text: '#e1e6ea' };

const rtlCache = createCache({ key: 'muirtl', stylisPlugins: [prefixer, rtlPlugin] });
const ltrCache = createCache({ key: 'muiltr', stylisPlugins: [prefixer] });

export function MuiProvider({ children }: { children: ReactNode }) {
  const { mode } = useThemeContext();
  const { i18n } = useTranslation();
  const direction = i18n.language === 'fa' ? 'rtl' : 'ltr';

  const theme = useMemo(
    () =>
      createTheme({
        direction,
        palette: {
          mode,
          primary: { main: BRAND[500], dark: BRAND[600] },
          background:
            mode === 'dark'
              ? { paper: DARK.paper, default: DARK.elevated }
              : { paper: '#ffffff', default: '#f8fafc' },
          // Spread conditionally — an explicit `text: undefined` WIPES the
          // default palette.text and crashes every input-derived component.
          ...(mode === 'dark' ? { text: { primary: DARK.text, secondary: '#9aa6b5' } } : {}),
        },
        shape: { borderRadius: 10 },
        typography: {
          // Inherit the app font stack (Vazirmatn in fa) instead of Roboto.
          fontFamily: 'inherit',
          button: { textTransform: 'none' },
        },
        components: {
          MuiPaper: {
            styleOverrides: {
              root: { backgroundImage: 'none' },
            },
          },
          MuiListItemButton: {
            defaultProps: { dense: true },
          },
        },
      }),
    [mode, direction],
  );

  return (
    <CacheProvider value={direction === 'rtl' ? rtlCache : ltrCache}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </CacheProvider>
  );
}
