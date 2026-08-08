import { type ThemeOptions, createTheme } from '@mui/material/styles';
import { darkSurface, primary, shadows, status } from './palette';

/**
 * FleetVision dark theme (v2 — premium dark SaaS).
 *
 * Deep navy surfaces with a glassmorphism depth, refined-blue gradient accents,
 * and soft glow shadows. Defaults to dark for the NOC/dispatcher aesthetic
 * (UI_UX_Design.md §0.2 — "dark mode is first-class").
 */
export const darkTheme = createTheme({
  palette: {
    mode: 'dark',
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
      default: darkSurface.bg,
      paper: darkSurface.paper,
    },
    text: {
      primary: '#F1F5F9',
      secondary: '#94A3B8',
      disabled: '#475569',
    },
    divider: darkSurface.border,
    action: {
      hover: 'rgba(59,130,246,0.08)',
      selected: 'rgba(59,130,246,0.12)',
      focus: 'rgba(59,130,246,0.16)',
      disabledBackground: 'rgba(148,163,184,0.08)',
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
            'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(59,130,246,0.12), transparent)',
          backgroundColor: darkSurface.bg,
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
          boxShadow: '0 4px 14px rgba(59,130,246,0.3)',
          '&:hover': {
            boxShadow: '0 6px 20px rgba(59,130,246,0.4)',
            filter: 'brightness(1.08)',
          },
          '&:active': { filter: 'brightness(0.95)' },
        },
        outlined: {
          borderColor: darkSurface.borderLight,
          '&:hover': {
            borderColor: primary.main,
            backgroundColor: 'rgba(59,130,246,0.08)',
          },
        },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          borderRadius: 14,
          backgroundColor: darkSurface.elevated,
          backgroundImage: 'none',
          border: '1px solid',
          borderColor: darkSurface.border,
          boxShadow: shadows.darkCard,
          backdropFilter: 'blur(12px)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: darkSurface.bg,
          borderRight: '1px solid',
          borderColor: darkSurface.border,
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: darkSurface.bg,
          borderBottom: '1px solid',
          borderColor: darkSurface.border,
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
            '&:hover': { filter: 'brightness(1.08)' },
          },
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 10,
            backgroundColor: darkSurface.hover,
            '& fieldset': { borderColor: darkSurface.borderLight },
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
          backgroundColor: darkSurface.hover,
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
          borderColor: darkSurface.borderLight,
          '&.Mui-selected': {
            backgroundColor: 'rgba(59,130,246,0.15)',
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
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: darkSurface.elevated,
          border: '1px solid',
          borderColor: darkSurface.borderLight,
          fontSize: '0.75rem',
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          backgroundColor: darkSurface.elevated,
          border: '1px solid',
          borderColor: darkSurface.border,
          borderRadius: 12,
          boxShadow: shadows.darkElevated,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: darkSurface.paper,
          border: '1px solid',
          borderColor: darkSurface.border,
          borderRadius: 16,
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottomColor: darkSurface.border },
        head: { fontWeight: 600, color: '#94A3B8' },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 99 },
      },
    },
  },
} satisfies ThemeOptions);
