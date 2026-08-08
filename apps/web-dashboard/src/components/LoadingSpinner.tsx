import { Box, CircularProgress, type SxProps, type Theme } from '@mui/material';

interface LoadingSpinnerProps {
  /** Optional size of the spinner in pixels. */
  size?: number;
  /** Optional MUI sx prop. */
  sx?: SxProps<Theme>;
}

/**
 * Centered loading spinner with optional sizing.
 */
export function LoadingSpinner({ size = 40, sx }: LoadingSpinnerProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        py: 4,
        ...sx,
      }}
    >
      <CircularProgress size={size} />
    </Box>
  );
}
