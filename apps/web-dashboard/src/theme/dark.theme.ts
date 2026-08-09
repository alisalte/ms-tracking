import { type ThemeOptions, createTheme } from '@mui/material/styles';
import { darkSurface, neutral, pillRadius, primary, shadows, status } from './palette';
import { FONT_LATIN } from './theme';

/**
 * FleetVision dark theme (v3 — Limitless-inspired).
 *
 * Layered slate surfaces (Limitless dark family) with the same dense Roboto
 * typography, 3px corners, and Material status colors as the light theme so
 * toggling feels cohesive. The dark slate sidebar stays constant (it already
 * matches the dark surfaces). Dark mode is fully supported but no longer the
 * default (see ThemeRegistry).
 */
export const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: primary.light,
      light: '#90CAF9',
      dark: primary.main,
      contrastText: '#0B1727',
    },
    secondary: {
      main: '#7986CB',
      light: '#9FA8DA',
      dark: '#5C6BC0',
      contrastText: '#0B1727',
    },
    error: { main: status.dangerLight, light: '#E57373', contrastText: '#1A0A0A' },
    warning: { main: status.warningLight, light: '#FFAB91', contrastText: '#1A0900' },
    success: { main: status.successLight, light: '#A5D6A7', contrastText: '#06250A' },
    info: { main: status.infoLight, light: '#80DEEA', contrastText: '#03222A' },
    background: {
      default: darkSurface.bg,
      paper: darkSurface.paper,
    },
    text: {
      primary: '#ECEFF1',
      secondary: '#B0BEC5',
      disabled: '#607D8B',
    },
    divider: darkSurface.divider,
    action: {
      hover: 'rgba(255,255,255,0.06)',
      selected: 'rgba(33,150,243,0.18)',
      focus: 'rgba(33,150,243,0.24)',
      disabledBackground: 'rgba(255,255,255,0.06)',
    },
  },
  typography: {
    fontFamily: FONT_LATIN,
    h1: { fontSize: '1.5625rem', fontWeight: 500, lineHeight: 1.3, letterSpacing: '-0.01em' },
    h2: { fontSize: '1.4375rem', fontWeight: 500, lineHeight: 1.3, letterSpacing: '-0.01em' },
    h3: { fontSize: '1.3125rem', fontWeight: 500, lineHeight: 1.35 },
    h4: { fontSize: '1.1875rem', fontWeight: 500, lineHeight: 1.4 },
    h5: { fontSize: '1.0625rem', fontWeight: 600, lineHeight: 1.4 },
    h6: { fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.4 },
    subtitle1: { fontSize: '0.9375rem', fontWeight: 500 },
    subtitle2: { fontSize: '0.875rem', fontWeight: 600 },
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
        body: { backgroundColor: darkSurface.bg, color: '#ECEFF1' },
        ':root': { '--fv-page-padding': '20px' },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'default' },
      styleOverrides: {
        root: {
          backgroundColor: darkSurface.paper,
          color: '#ECEFF1',
          borderBottom: '1px solid',
          borderColor: darkSurface.divider,
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
          borderColor: darkSurface.borderStrong,
          color: '#B0BEC5',
          '&:hover': {
            borderColor: primary.light,
            backgroundColor: 'rgba(33,150,243,0.12)',
            color: primary.light,
          },
        },
        outlinedPrimary: {
          borderColor: primary.light,
          color: primary.light,
          '&:hover': { borderColor: primary.main, backgroundColor: 'rgba(33,150,243,0.14)' },
        },
        text: { color: '#B0BEC5' },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          borderRadius: 3,
          backgroundColor: darkSurface.paper,
          border: '1px solid',
          borderColor: darkSurface.divider,
          boxShadow: shadows.darkCard,
          backgroundImage: 'none',
        },
      },
    },
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: 'none' } },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: { backgroundColor: darkSurface.paper, backgroundImage: 'none' },
      },
    },
    MuiToolbar: {
      styleOverrides: { root: { minHeight: '50px !important', height: '50px' } },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 3,
          transition: 'background-color 0.15s ease-in-out, color 0.15s ease-in-out',
          '&.Mui-selected': {
            backgroundColor: 'rgba(33,150,243,0.18)',
            color: primary.light,
            '&:hover': { backgroundColor: 'rgba(33,150,243,0.22)' },
          },
        },
      },
    },
    MuiOutlinedInput: {
      defaultProps: { notched: false },
      styleOverrides: {
        root: {
          borderRadius: 3,
          backgroundColor: darkSurface.hover,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: darkSurface.borderStrong },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#607D8B' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: primary.light,
            borderWidth: 1,
          },
        },
        input: { paddingInline: 12, paddingBlock: 9, fontSize: '0.8125rem' },
        notchedOutline: { borderColor: darkSurface.borderStrong },
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
      styleOverrides: { select: { borderRadius: 3, paddingTop: 9, paddingBottom: 9 } },
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
      styleOverrides: { badge: { fontWeight: 600, height: 16, minWidth: 16, fontSize: '0.6rem' } },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 3, fontSize: '0.8125rem', alignItems: 'center' },
        standardSuccess: {
          backgroundColor: 'rgba(76,175,80,0.18)',
          color: status.successLight,
        },
        standardWarning: {
          backgroundColor: 'rgba(255,87,34,0.18)',
          color: status.warningLight,
        },
        standardError: {
          backgroundColor: 'rgba(244,67,54,0.18)',
          color: status.dangerLight,
        },
        standardInfo: {
          backgroundColor: 'rgba(0,188,212,0.18)',
          color: status.infoLight,
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          borderRadius: 3,
          borderColor: darkSurface.borderStrong,
          color: '#B0BEC5',
          textTransform: 'none',
          '&.Mui-selected': {
            backgroundColor: 'rgba(33,150,243,0.18)',
            borderColor: primary.light,
            color: primary.light,
            '&:hover': { backgroundColor: 'rgba(33,150,243,0.22)' },
          },
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 40 },
        indicator: { backgroundColor: primary.light, height: 2 },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none' as const,
          fontWeight: 500,
          minHeight: 40,
          fontSize: '0.8125rem',
          color: '#B0BEC5',
          '&.Mui-selected': { color: primary.light, fontWeight: 600 },
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: neutral[950],
          border: '1px solid',
          borderColor: darkSurface.borderStrong,
          fontSize: '0.6875rem',
          borderRadius: 3,
          padding: '5px 9px',
        },
        arrow: { color: neutral[950] },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          backgroundColor: darkSurface.elevated,
          border: '1px solid',
          borderColor: darkSurface.divider,
          borderRadius: 3,
          boxShadow: shadows.darkElevated,
          backgroundImage: 'none',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: darkSurface.paper,
          border: '1px solid',
          borderColor: darkSurface.divider,
          borderRadius: 3,
          boxShadow: shadows.darkElevated,
          backgroundImage: 'none',
        },
      },
    },
    // ── Tables ──
    MuiTableContainer: {
      styleOverrides: { root: { backgroundColor: 'transparent' } },
    },
    MuiTableHead: {
      styleOverrides: { root: { backgroundColor: darkSurface.tableHead } },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:hover': { backgroundColor: 'rgba(255,255,255,0.04)' },
          '&.Mui-selected': { backgroundColor: 'rgba(33,150,243,0.16)' },
          '&.Mui-selected:hover': { backgroundColor: 'rgba(33,150,243,0.20)' },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: '1px solid',
          borderColor: darkSurface.divider,
          fontSize: '0.8125rem',
          paddingInline: 16,
          paddingBlock: 8,
        },
        head: {
          fontWeight: 700,
          color: '#90A4AE',
          backgroundColor: darkSurface.tableHead,
          borderBottomWidth: 2,
          borderBottomColor: neutral[500],
          fontSize: '0.6875rem',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        },
        body: { color: '#ECEFF1' },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: pillRadius, backgroundColor: darkSurface.border },
      },
    },
    MuiAvatar: {
      styleOverrides: { root: { fontWeight: 600, fontSize: '0.8125rem' } },
    },
    MuiDivider: {
      styleOverrides: { root: { borderColor: darkSurface.divider } },
    },
    MuiIconButton: {
      styleOverrides: {
        root: { color: '#B0BEC5', transition: 'all 0.15s ease-in-out' },
      },
    },
  },
} satisfies ThemeOptions);
