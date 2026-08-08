import { type ThemeOptions, createTheme } from '@mui/material/styles';
import { neutral, primary, status } from './palette';

/**
 * FleetVision dark theme.
 *
 * Map dashboard defaults to dark; others follow OS preference.
 * Source: UI_UX_Design.md §0.2 (Dark mode is first-class)
 */
export const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#3B82F6', // Lighter blue for dark backgrounds
      dark: primary.main,
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#94A3B8',
      light: '#475569',
    },
    error: {
      main: '#EF4444', // Slightly lighter red for dark
    },
    warning: {
      main: status.amber,
    },
    success: {
      main: '#22C55E', // Slightly lighter green for dark
    },
    info: {
      main: '#60A5FA',
    },
    background: {
      default: neutral[900],
      paper: '#1A2332', // Slightly lighter than background
    },
    text: {
      primary: neutral[50],
      secondary: '#94A3B8',
    },
    divider: '#2D3A4A',
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: {
      fontSize: '2.25rem',
      fontWeight: 700,
      lineHeight: 1.2,
    },
    h2: {
      fontSize: '1.875rem',
      fontWeight: 700,
      lineHeight: 1.2,
    },
    h3: {
      fontSize: '1.25rem',
      fontWeight: 600,
      lineHeight: 1.2,
    },
    h4: {
      fontSize: '1.125rem',
      fontWeight: 600,
      lineHeight: 1.2,
    },
    h5: {
      fontSize: '1rem',
      fontWeight: 600,
      lineHeight: 1.2,
    },
    h6: {
      fontSize: '0.875rem',
      fontWeight: 500,
      lineHeight: 1.2,
    },
    body1: {
      fontSize: '0.875rem',
      fontWeight: 400,
      lineHeight: 1.5,
    },
    body2: {
      fontSize: '0.8125rem',
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
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          backgroundImage: 'none',
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
  },
} satisfies ThemeOptions);
