/**
 * PermissionsSection — the full canonical permission catalog rendered by domain
 * (02_Domain_Model §6.1). A read-only reference of every permission the
 * platform defines, grouped by the 14 bounded-context domains.
 */
import { useTranslation } from 'react-i18next';

import type { PermissionGroup } from '@/types/admin.types';
import { Box, Chip, Stack, Typography } from '@mui/material';

interface PermissionsSectionProps {
  catalog: PermissionGroup[];
}

export function PermissionsSection({ catalog }: PermissionsSectionProps) {
  const { t } = useTranslation();
  return (
    <Stack gap={1.5} sx={{ p: 2 }}>
      <Typography variant="body2" color="text.secondary">
        {t('admin.permissions.subtitle')}
      </Typography>
      <Box
        sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' }, gap: 1.5 }}
      >
        {catalog.map((group) => (
          <Box
            key={group.domain}
            sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}
          >
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ mb: 1 }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                {t(group.labelKey)}
              </Typography>
              <Chip
                size="small"
                label={group.permissions.length}
                sx={{ height: 18, fontSize: '0.6rem' }}
              />
            </Stack>
            <Stack gap={0.25}>
              {group.permissions.map((p) => (
                <Typography
                  key={p}
                  variant="caption"
                  sx={{ fontFamily: 'monospace', fontSize: '0.68rem', color: 'text.secondary' }}
                >
                  {p}
                </Typography>
              ))}
            </Stack>
          </Box>
        ))}
      </Box>
    </Stack>
  );
}
