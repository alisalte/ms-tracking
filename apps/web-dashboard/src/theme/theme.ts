import { type ThemeOptions, createTheme } from '@mui/material/styles';
import { lightSurface, neutral, primary, shadows, status } from './palette';

/**
 * FleetVision light theme (v2 — polished enterprise).
 *
 * Clean white surfaces with a refined-blue gradient accent, subtle shadows, and
 * the Inter font. Shares the same component rounding and gradient system as the
 * dark theme so toggling feels cohesive.
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
      main: status.purple,
      light: '#C084FC',
      contrastText: '#FFFFFF',
    },
    error: { main: status.red },
    warning: { main: status.amber },
    success: { main: status.green },
    info: { main: status.blue },
    background: {
      default: lightSurface.bg,
      paper: lightSurface.paper,
    },
    text: {
      primary: neutral[900],
      secondary: neutral[500],
      disabled: neutral[400],
    },
    divider: lightSurface.border,
    action: {
      hover: 'rgba(59,130,246,0.06)',
      selected: 'rgba(59,130,246,0.1)',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontSize: '2.25rem', fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.02em' },
    h2: { fontSize: '1.875rem', fontWeight: 800, lineHeight: 1.2, letterSpacing: '-0.02em' },
    h3: { fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.01em' },
    h4: { fontSize: '1.25rem', fontWeight: 700, lineHeight: 1.25 },
    h5: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.25 },
    h6: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.25 },
    subtitle1: { fontSize: '0.95rem', fontWeight: 500 },
    subtitle2: { fontSize: '0.875rem', fontWeight: 500 },
    body1: { fontSize: '0.875rem', fontWeight: 400, lineHeight: 1.6 },
    body2: { fontSize: '0.8125rem', fontWeight: 400, lineHeight: 1.5 },
    caption: { fontSize: '0.75rem', fontWeight: 400 },
    overline: {
      fontSize: '0.6875rem',
      fontWeight: 600,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
    },
    button: { textTransform: 'none' as const, fontWeight: 600, fontSize: '0.875rem' },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundImage:
            'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(59,130,246,0.06), transparent)',
          backgroundColor: lightSurface.bg,
          backgroundAttachment: 'fixed',
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 10,
          fontWeight: 600,
          paddingInline: 18,
          paddingBlock: 10,
          transition: 'all 0.2s ease',
        },
        containedPrimary: {
          background: primary.gradient,
          boxShadow: '0 4px 14px rgba(59,130,246,0.25)',
          '&:hover': {
            boxShadow: '0 6px 20px rgba(59,130,246,0.35)',
            filter: 'brightness(1.05)',
          },
          '&:active': { filter: 'brightness(0.95)' },
        },
        outlined: {
          borderColor: lightSurface.borderLight,
          '&:hover': {
            borderColor: primary.main,
            backgroundColor: 'rgba(59,130,246,0.06)',
          },
        },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          borderRadius: 14,
          backgroundColor: lightSurface.paper,
          border: '1px solid',
          borderColor: lightSurface.border,
          boxShadow: shadows.card,
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: lightSurface.paper,
          borderRight: '1px solid',
          borderColor: lightSurface.border,
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: lightSurface.paper,
          borderBottom: '1px solid',
          borderColor: lightSurface.border,
          backgroundImage: 'none',
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          marginInline: 8,
          marginBottom: 2,
          '&.Mui-selected': {
            background: primary.gradient,
            color: '#fff',
            '&:hover': { filter: 'brightness(1.05)' },
            '& .MuiListItemIcon-root': { color: '#fff' },
          },
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 10,
            '& fieldset': { borderColor: lightSurface.borderLight },
            '&:hover fieldset': { borderColor: primary.main },
            '&.Mui-focused fieldset': { borderColor: primary.main },
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 10,
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        select: { borderRadius: 10 },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 8, fontWeight: 600 },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          borderColor: lightSurface.borderLight,
          '&.Mui-selected': {
            backgroundColor: 'rgba(59,130,246,0.1)',
            borderColor: primary.main,
          },
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: { textTransform: 'none' as const, fontWeight: 600 },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottomColor: lightSurface.border },
        head: { fontWeight: 600, color: neutral[500] },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 99 },
      },
    },
  },
} satisfies ThemeOptions);
