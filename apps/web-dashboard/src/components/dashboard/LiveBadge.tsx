import { Box, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

/**
 * Live freshness indicator (UI_UX_Design.md §0.6): a pulsing 6px dot + "Live"
 * label, signaling data is real-time (<10s fresh).
 */
export function LiveBadge() {
  const { t } = useTranslation();
  return (
    <Stack direction="row" alignItems="center" gap={0.5}>
      <Box
        component="span"
        sx={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          backgroundColor: 'success.main',
          display: 'inline-block',
          animation: 'fv-pulse 1.6s ease-in-out infinite',
        }}
      />
      <Typography variant="caption" color="success.main" fontWeight={600}>
        {t('dashboard.live')}
      </Typography>
    </Stack>
  );
}
