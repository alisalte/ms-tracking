/**
 * RolesSection — the roles registry (UI_UX §5.3 bottom "Roles (custom)" + the
 * system roles from 02_Domain_Model §6.2).
 *
 * Lists system + custom roles with permission counts + member counts. Click a
 * role to open the RoleDetailDrawer showing its permission matrix grouped by
 * domain (§6.1 catalog).
 */
import { useTranslation } from 'react-i18next';

import type { Role } from '@/types/admin.types';
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

interface RolesSectionProps {
  roles: Role[];
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (id: string) => void;
}

export function RolesSection({ roles, loading = false, selectedId, onSelect }: RolesSectionProps) {
  const { t } = useTranslation();
  const system = roles.filter((r) => r.isSystem);
  const custom = roles.filter((r) => !r.isSystem);

  if (loading) {
    return (
      <Stack gap={1.5} sx={{ p: 2 }}>
        {['rsk-a', 'rsk-b', 'rsk-c'].map((k) => (
          <Skeleton key={k} variant="rounded" height={90} />
        ))}
      </Stack>
    );
  }

  return (
    <Stack gap={2} sx={{ p: 2 }}>
      {/* Custom roles (UI_UX §5.3) */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t('admin.roles.custom')}
        </Typography>
        <RoleGrid roles={custom} selectedId={selectedId} onSelect={onSelect} t={t} />
      </Box>

      {/* System roles (§6.2) */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t('admin.roles.system')}
        </Typography>
        <RoleGrid roles={system} selectedId={selectedId} onSelect={onSelect} t={t} />
      </Box>
    </Stack>
  );
}

/** A responsive grid of role cards. */
function RoleGrid({
  roles,
  selectedId,
  onSelect,
  t,
}: {
  roles: Role[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  t: (k: string) => string;
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
        gap: 1.5,
      }}
    >
      {roles.map((r) => (
        <Card
          key={r.id}
          variant="outlined"
          sx={{
            borderColor: r.id === selectedId ? 'primary.main' : 'divider',
            borderWidth: r.id === selectedId ? 2 : 1,
          }}
        >
          <CardActionArea onClick={() => onSelect(r.id)}>
            <CardContent>
              <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }} noWrap>
                  {r.name}
                </Typography>
                {r.mfaRequired && (
                  <Chip
                    size="small"
                    label="MFA"
                    color="error"
                    sx={{ height: 16, fontSize: '0.55rem' }}
                  />
                )}
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, minHeight: 36 }}>
                {r.description}
              </Typography>
              <Stack direction="row" gap={2} sx={{ mt: 1 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {t('admin.roles.permissions')}
                  </Typography>
                  <Typography variant="h6">{r.permissionKeys.length}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {t('admin.roles.members')}
                  </Typography>
                  <Typography variant="h6">{r.memberCount}</Typography>
                </Box>
              </Stack>
            </CardContent>
          </CardActionArea>
        </Card>
      ))}
    </Box>
  );
}
