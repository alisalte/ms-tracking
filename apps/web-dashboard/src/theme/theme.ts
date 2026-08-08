import { type ThemeOptions, createTheme } from '@mui/material/styles';
import { neutral, primary, status } from './palette';

/**
 * FleetVision light theme.
 *
 * Follows the Design System (§0.2–0.4):
 * - Primary deep blue (#2563EB)
 * - Neutral slate scale
 * - Inter font for UI, JetBrains Mono for data
 * - 8-point spacing grid
 */
export const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: primary.main,
      dark: primary.pressed,
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: neutral[500],
      light: neutral[100],
    },
    error: {
      main: status.red,
    },
    warning: {
      main: status.amber,
    },
    success: {
      main: status.green,
    },
    info: {
      main: status.blue,
    },
    background: {
      default: neutral[0],
      paper: neutral[0],
    },
    text: {
      primary: neutral[800],
      secondary: neutral[500],
    },
    divider: neutral[200],
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: {
      fontSize: '2.25rem', // 36px
      fontWeight: 700,
      lineHeight: 1.2,
    },
    h2: {
      fontSize: '1.875rem', // 30px
      fontWeight: 700,
      lineHeight: 1.2,
    },
    h3: {
      fontSize: '1.25rem', // 20px
      fontWeight: 600,
      lineHeight: 1.2,
    },
    h4: {
      fontSize: '1.125rem', // 18px
      fontWeight: 600,
      lineHeight: 1.2,
    },
    h5: {
      fontSize: '1rem', // 16px
      fontWeight: 600,
      lineHeight: 1.2,
    },
    h6: {
      fontSize: '0.875rem', // 14px
      fontWeight: 500,
      lineHeight: 1.2,
    },
    subtitle1: {
      fontSize: '0.875rem', // 14px
      fontWeight: 500,
    },
    subtitle2: {
      fontSize: '0.8125rem', // 13px
      fontWeight: 500,
    },
    body1: {
      fontSize: '0.875rem', // 14px (base)
      fontWeight: 400,
      lineHeight: 1.5,
    },
    body2: {
      fontSize: '0.8125rem', // 13px
      fontWeight: 400,
      lineHeight: 1.5,
    },
    button: {
      textTransform: 'none' as const,
      fontWeight: 500,
    },
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontWeight: 500,
        },
        containedPrimary: {
          '&:hover': {
            backgroundColor: primary.hover,
          },
          '&:active': {
            backgroundColor: primary.pressed,
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          boxShadow: '0px 1px 3px rgba(0, 0, 0, 0.08), 0px 1px 2px rgba(0, 0, 0, 0.06)',
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 6,
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 6,
        },
      },
    },
  },
} satisfies ThemeOptions);
