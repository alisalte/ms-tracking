/**
 * GroupsTab — the vehicle-group registry (Fleet-Management §2 VehicleGroup).
 *
 * Renders groups as cards with member counts + type filter + status. Click a
 * card to open the group detail drawer.
 */
import { useTranslation } from 'react-i18next';

import { groupStatusColor } from '@/components/assets/asset-meta';
import type { VehicleGroup } from '@/types/asset.types';
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';

interface GroupsTabProps {
  groups: VehicleGroup[];
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (id: string) => void;
}

export function GroupsTab({ groups, loading = false, selectedId, onSelect }: GroupsTabProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 1.5,
          p: 2,
        }}
      >
        {['gsk-a', 'gsk-b', 'gsk-c', 'gsk-d'].map((k) => (
          <Skeleton key={k} variant="rounded" height={110} />
        ))}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 1.5,
        p: 2,
      }}
    >
      {groups.map((g) => (
        <Card
          key={g.id}
          variant="outlined"
          sx={{
            borderColor: g.id === selectedId ? 'primary.main' : 'divider',
            borderWidth: g.id === selectedId ? 2 : 1,
          }}
        >
          <CardActionArea onClick={() => onSelect(g.id)}>
            <CardContent>
              <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }} noWrap>
                  {g.name}
                </Typography>
                <Chip
                  size="small"
                  label={t(`assets.group.status.${g.status}`)}
                  sx={{
                    height: 18,
                    fontSize: '0.65rem',
                    fontWeight: 600,
                    color: '#fff',
                    bgcolor: groupStatusColor(g.status),
                  }}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, minHeight: 32 }}>
                {g.description}
              </Typography>
              <Stack direction="row" gap={2} sx={{ mt: 1 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {t('assets.group.members')}
                  </Typography>
                  <Typography variant="h6">{g.memberCount}</Typography>
                </Box>
                {g.vehicleTypeFilter && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      {t('assets.group.typeFilter')}
                    </Typography>
                    <Typography variant="body2">
                      {t(`assets.vehicle.type.${g.vehicleTypeFilter}`)}
                    </Typography>
                  </Box>
                )}
              </Stack>
            </CardContent>
          </CardActionArea>
        </Card>
      ))}
      {groups.length === 0 && (
        <Typography
          color="text.secondary"
          sx={{ py: 4, textAlign: 'center', gridColumn: '1 / -1' }}
        >
          {t('assets.empty')}
        </Typography>
      )}
    </Box>
  );
}
