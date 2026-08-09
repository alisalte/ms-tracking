import { type ThemeOptions, createTheme } from '@mui/material/styles';
import { lightSurface, neutral, pillRadius, primary, shadows, status } from './palette';

/**
 * Latin-first font stack (LTR). Roboto leads for the Limitless look.
 */
export const FONT_LATIN =
  '"Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

/**
 * Persian-first font stack (RTL). Vazirmatn leads — it ships both Persian and
 * Latin glyphs, so mixed content stays consistent.
 */
export const FONT_PERSIAN =
  '"Vazirmatn", "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

/**
 * Resolve the body font stack for the active text direction. Used by the theme
 * overrides AND by `ThemeRegistry` so MUI/Emotion actually applies Vazirmatn in
 * RTL (the `global.css` rule alone is overridden by MUI's per-component styles).
 */
export function fontStackFor(direction: 'ltr' | 'rtl'): string {
  return direction === 'rtl' ? FONT_PERSIAN : FONT_LATIN;
}

/**
 * FleetVision light theme (v3 — Limitless-inspired).
 *
 * Limitless Layout 1: light top navbar, #F5F5F5 content, near-white cards with
 * a barely-there 1px shadow, 3px corners, dense Roboto 13px body, Material
 * system status colors. The dark slate sidebar is a separate constant surface
 * (see palette.ts → sidebar) so it stays dark in both modes.
 */
export const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: primary.main,
      light: primary.light,
      dark: primary.dark,
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: status.indigo,
      light: '#7986CB',
      dark: '#303F9F',
      contrastText: '#FFFFFF',
    },
    error: { main: status.danger, light: status.dangerLight, contrastText: '#FFFFFF' },
    warning: { main: status.warning, light: status.warningLight, contrastText: '#FFFFFF' },
    success: { main: status.success, light: status.successLight, contrastText: '#FFFFFF' },
    info: { main: status.info, light: status.infoLight, contrastText: '#FFFFFF' },
    background: {
      default: lightSurface.bg,
      paper: lightSurface.paper,
    },
    text: {
      primary: neutral[900],
      secondary: neutral[700],
      disabled: neutral[500],
    },
    divider: lightSurface.divider,
    action: {
      hover: neutral[25],
      selected: primary.tint,
      focus: 'rgba(33,150,243,0.18)',
      disabledBackground: 'rgba(0,0,0,0.04)',
    },
  },
  typography: {
    fontFamily: FONT_LATIN,
    // Limitless heading scale — medium weight, not heavy.
    h1: { fontSize: '1.5625rem', fontWeight: 500, lineHeight: 1.3, letterSpacing: '-0.01em' },
    h2: { fontSize: '1.4375rem', fontWeight: 500, lineHeight: 1.3, letterSpacing: '-0.01em' },
    h3: { fontSize: '1.3125rem', fontWeight: 500, lineHeight: 1.35 },
    h4: { fontSize: '1.1875rem', fontWeight: 500, lineHeight: 1.4 },
    h5: { fontSize: '1.0625rem', fontWeight: 600, lineHeight: 1.4 },
    h6: { fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.4 },
    subtitle1: { fontSize: '0.9375rem', fontWeight: 500 },
    subtitle2: { fontSize: '0.875rem', fontWeight: 600 },
    // Dense 13px body — Limitless signature.
    body1: { fontSize: '0.8125rem', fontWeight: 400, lineHeight: 1.538 },
    body2: { fontSize: '0.75rem', fontWeight: 400, lineHeight: 1.5 },
    caption: { fontSize: '0.6875rem', fontWeight: 400 },
    overline: {
      fontSize: '0.6875rem',
      fontWeight: 700,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
    },
    button: { textTransform: 'none' as const, fontWeight: 500, fontSize: '0.8125rem' },
  },
  shape: { borderRadius: 3 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: lightSurface.bg,
          color: neutral[900],
        },
        ':root': {
          '--fv-page-padding': '20px',
        },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'default' },
      styleOverrides: {
        root: {
          backgroundColor: lightSurface.paper,
          color: neutral[900],
          borderBottom: '1px solid',
          borderColor: lightSurface.divider,
          backgroundImage: 'none',
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 3,
          fontWeight: 500,
          paddingInline: 14,
          paddingBlock: 7,
          minHeight: 34,
          transition: 'all 0.15s ease-in-out',
        },
        sizeSmall: { paddingInline: 10, paddingBlock: 4, minHeight: 28, fontSize: '0.75rem' },
        sizeLarge: { paddingInline: 20, paddingBlock: 10, minHeight: 42, fontSize: '0.875rem' },
        containedPrimary: {
          backgroundColor: primary.main,
          boxShadow: 'none',
          '&:hover': { backgroundColor: primary.hover, boxShadow: 'none' },
          '&:active': { backgroundColor: primary.pressed, boxShadow: 'none' },
        },
        outlined: {
          borderColor: lightSurface.borderStrong,
          color: neutral[800],
          '&:hover': {
            borderColor: primary.main,
            backgroundColor: primary.tint,
            color: primary.dark,
          },
        },
        outlinedPrimary: {
          borderColor: primary.main,
          '&:hover': { borderColor: primary.dark, backgroundColor: primary.tint },
        },
        text: { color: neutral[700] },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          borderRadius: 3,
          backgroundColor: lightSurface.paper,
          border: '1px solid',
          borderColor: lightSurface.border,
          boxShadow: shadows.card,
          backgroundImage: 'none',
        },
      },
    },
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: 'none' } },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: lightSurface.paper,
          backgroundImage: 'none',
        },
      },
    },
    MuiToolbar: {
      styleOverrides: {
        root: {
          minHeight: '50px !important',
          height: '50px',
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 3,
          transition: 'background-color 0.15s ease-in-out, color 0.15s ease-in-out',
          '&.Mui-selected': {
            backgroundColor: primary.tint,
            color: primary.dark,
            '&:hover': { backgroundColor: primary.tint },
          },
        },
      },
    },
    MuiOutlinedInput: {
      defaultProps: { notched: false },
      styleOverrides: {
        root: {
          borderRadius: 3,
          backgroundColor: lightSurface.paper,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: lightSurface.borderStrong },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: neutral[500] },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: primary.main,
            borderWidth: 1,
          },
        },
        input: { paddingInline: 12, paddingBlock: 9, fontSize: '0.8125rem' },
      },
    },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiInputLabel: {
      styleOverrides: {
        root: { fontSize: '0.8125rem' },
        shrink: { transform: 'translate(0, -7px) scale(0.85)' },
      },
    },
    MuiInputBase: { styleOverrides: { input: { fontSize: '0.8125rem' } } },
    MuiSelect: {
      styleOverrides: {
        select: { borderRadius: 3, paddingTop: 9, paddingBottom: 9 },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: pillRadius, fontWeight: 600, height: 22, fontSize: '0.6875rem' },
        sizeSmall: { height: 20, fontSize: '0.65rem' },
        sizeMedium: { height: 26 },
        outlined: { backgroundColor: 'transparent' },
      },
    },
    MuiBadge: {
      styleOverrides: {
        badge: { fontWeight: 600, height: 16, minWidth: 16, fontSize: '0.6rem' },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 3, fontSize: '0.8125rem', alignItems: 'center' },
        standardSuccess: { backgroundColor: status.successBg, color: '#2E7D32' },
        standardWarning: { backgroundColor: status.warningBg, color: '#D84315' },
        standardError: { backgroundColor: status.dangerBg, color: '#C62828' },
        standardInfo: { backgroundColor: status.infoBg, color: '#0097A7' },
        outlinedSuccess: { color: '#2E7D32', borderColor: status.successLight },
        outlinedWarning: { color: '#D84315', borderColor: status.warningLight },
        outlinedError: { color: '#C62828', borderColor: status.dangerLight },
        outlinedInfo: { color: '#0097A7', borderColor: status.infoLight },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          borderRadius: 3,
          borderColor: lightSurface.borderStrong,
          color: neutral[700],
          textTransform: 'none',
          '&.Mui-selected': {
            backgroundColor: primary.tint,
            borderColor: primary.main,
            color: primary.dark,
            '&:hover': { backgroundColor: primary.tint },
          },
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 40 },
        indicator: { backgroundColor: primary.main, height: 2 },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none' as const,
          fontWeight: 500,
          minHeight: 40,
          fontSize: '0.8125rem',
          color: neutral[700],
          '&.Mui-selected': { color: primary.dark, fontWeight: 600 },
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: neutral[900],
          fontSize: '0.6875rem',
          borderRadius: 3,
          padding: '5px 9px',
        },
        arrow: { color: neutral[900] },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          backgroundColor: lightSurface.paper,
          border: '1px solid',
          borderColor: lightSurface.divider,
          borderRadius: 3,
          boxShadow: shadows.raised,
          backgroundImage: 'none',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: lightSurface.paper,
          borderRadius: 3,
          boxShadow: shadows.elevated,
          backgroundImage: 'none',
        },
      },
    },
    // ── Tables — one consistent Limitless pattern ──
    MuiTableContainer: {
      styleOverrides: { root: { backgroundColor: 'transparent' } },
    },
    MuiTableHead: {
      styleOverrides: {
        root: { backgroundColor: lightSurface.tableHead },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:hover': { backgroundColor: neutral[25] },
          '&.Mui-selected': { backgroundColor: primary.tint },
          '&.Mui-selected:hover': { backgroundColor: primary.tint },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: '1px solid',
          borderColor: lightSurface.border,
          fontSize: '0.8125rem',
          paddingInline: 16,
          paddingBlock: 8,
        },
        head: {
          fontWeight: 700,
          color: neutral[700],
          backgroundColor: lightSurface.tableHead,
          borderBottomWidth: 2,
          borderBottomColor: neutral[500],
          fontSize: '0.6875rem',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        },
        body: { color: neutral[900] },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: pillRadius, backgroundColor: lightSurface.border },
      },
    },
    MuiAvatar: {
      styleOverrides: {
        root: { fontWeight: 600, fontSize: '0.8125rem' },
      },
    },
    MuiDivider: {
      styleOverrides: { root: { borderColor: lightSurface.divider } },
    },
    MuiIconButton: {
      styleOverrides: {
        root: { color: neutral[700], transition: 'all 0.15s ease-in-out' },
      },
    },
  },
} satisfies ThemeOptions);
