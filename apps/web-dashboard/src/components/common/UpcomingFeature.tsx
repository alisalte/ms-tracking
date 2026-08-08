import { Box, Chip, Stack, Typography } from '@mui/material';
/**
 * UpcomingFeature — placeholder page for features awaiting backend development.
 *
 * Renders a clear "coming soon" state with the feature name, description, and
 * the backend dependency. This follows the rule: "if the backend doesn't exist,
 * don't build a fake API — create a TODO + typed contract."
 */
import { Construction } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface UpcomingFeatureProps {
  /** Feature name (already translated). */
  title: string;
  /** Feature description (already translated). */
  description: string;
  /** The backend dependency that must land first. */
  backendDependency: string;
  /** Icon to display (lucide). */
  icon?: typeof Construction;
}

export function UpcomingFeature({
  title,
  description,
  backendDependency,
  icon: Icon = Construction,
}: UpcomingFeatureProps) {
  const { t } = useTranslation();

  return (
    <Stack alignItems="center" justifyContent="center" gap={3} sx={{ py: 10, textAlign: 'center' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 80,
          height: 80,
          borderRadius: '50%',
          bgcolor: 'action.hover',
        }}
      >
        <Icon size={36} color="#64748B" />
      </Box>
      <Box sx={{ maxWidth: 440 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
          {title}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {description}
        </Typography>
      </Box>
      <Chip
        icon={<span style={{ fontSize: 14 }}>🔧</span>}
        label={`${t('common.backendDependency', { defaultValue: 'Waiting for backend:' })} ${backendDependency}`}
        variant="outlined"
        sx={{ height: 28, fontSize: '0.8rem' }}
      />
      <Typography variant="caption" color="text.disabled">
        {t('common.typedContractReady', {
          defaultValue: 'Typed contracts are defined and ready for integration.',
        })}
      </Typography>
    </Stack>
  );
}
