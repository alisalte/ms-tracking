import { Box, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useThemeContext } from '@/theme/ThemeRegistry';

/**
 * Live freshness indicator (UI_UX_Design.md §0.6): a pulsing dot + "Live"
 * label inside a frosted-glass pill, signaling data is real-time (<10s fresh).
 *
 * v5: the plain text+dot is now a subtle glass pill with a green glow.
 */
export function LiveBadge() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { mode } = useThemeContext();
  const isDark = mode === 'dark' || theme.palette.mode === 'dark';

  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={0.5}
      sx={{
        px: 1,
        py: 0.25,
        borderRadius: 99,
        border: '1px solid',
        borderColor: isDark ? 'rgba(76,175,80,0.30)' : 'rgba(76,175,80,0.28)',
        backgroundColor: isDark ? 'rgba(76,175,80,0.14)' : 'rgba(76,175,80,0.10)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <Box
        component="span"
        sx={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          backgroundColor: 'success.main',
          display: 'inline-block',
          boxShadow: '0 0 6px rgba(76,175,80,0.7)',
          animation: 'fv-pulse 1.6s ease-in-out infinite',
        }}
      />
      <Typography
        variant="caption"
        color="success.main"
        fontWeight={700}
        sx={{ fontSize: '0.6875rem' }}
      >
        {t('dashboard.live')}
      </Typography>
    </Stack>
  );
}
