/**
 * RoleDetailDrawer — right slide-over showing a role's permission matrix
 * grouped by domain (02_Domain_Model §6.1 catalog). Each domain's permissions
 * render as a checklist reflecting whether the role grants them.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { PERMISSION_CATALOG } from '@/mock/admin-data';
import type { Role } from '@/types/admin.types';
import {
  Box,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';

const DRAWER_WIDTH = 460;

interface RoleDetailDrawerProps {
  role: Role | null;
  loading?: boolean;
  onClose: () => void;
}

export function RoleDetailDrawer({ role, loading = false, onClose }: RoleDetailDrawerProps) {
  const { t } = useTranslation();
  const open = Boolean(role);

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      variant="temporary"
      sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH, maxWidth: '100vw' } }}
    >
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : role ? (
        <Stack sx={{ height: '100%', overflowY: 'auto' }}>
          {/* Header */}
          <Stack
            direction="row"
            alignItems="center"
            gap={1.5}
            sx={{
              p: 2,
              borderBottom: '1px solid',
              borderColor: 'divider',
              position: 'sticky',
              top: 0,
              bgcolor: 'background.paper',
              zIndex: 1,
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }} noWrap>
                {role.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {role.description}
              </Typography>
            </Box>
            {role.mfaRequired && (
              <Chip
                size="small"
                label="MFA"
                color="error"
                sx={{ height: 18, fontSize: '0.6rem' }}
              />
            )}
            <IconButton onClick={onClose} aria-label={t('common.close')} size="small">
              ✕
            </IconButton>
          </Stack>

          <Stack gap={2} sx={{ p: 2 }}>
            <Box>
              <MetaRow
                label={t('admin.roles.type')}
                value={role.isSystem ? t('admin.roles.system') : t('admin.roles.custom')}
              />
              <MetaRow
                label={t('admin.roles.permissions')}
                value={String(role.permissionKeys.length)}
              />
              <MetaRow label={t('admin.roles.members')} value={String(role.memberCount)} />
            </Box>

            <Divider />

            {/* Permission matrix by domain (§6.1) */}
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
              >
                {t('admin.roles.permissionMatrix')}
              </Typography>
              <Stack gap={1.5} sx={{ mt: 1 }}>
                {PERMISSION_CATALOG.map((group) => {
                  const grantedInDomain = group.permissions.filter((p) =>
                    role.permissionKeys.includes(p),
                  );
                  const allGranted = grantedInDomain.length === group.permissions.length;
                  return (
                    <Box
                      key={group.domain}
                      sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}
                    >
                      <Stack direction="row" alignItems="center" justifyContent="space-between">
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {t(group.labelKey)}
                        </Typography>
                        <Chip
                          size="small"
                          label={`${grantedInDomain.length}/${group.permissions.length}`}
                          color={allGranted ? 'success' : 'default'}
                          variant={allGranted ? 'filled' : 'outlined'}
                          sx={{ height: 16, fontSize: '0.6rem' }}
                        />
                      </Stack>
                      <Box
                        sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.25, mt: 0.5 }}
                      >
                        {group.permissions.map((p) => (
                          <Stack
                            key={p}
                            direction="row"
                            alignItems="center"
                            gap={0.5}
                            sx={{ minHeight: 24 }}
                          >
                            <Checkbox
                              size="small"
                              checked={role.permissionKeys.includes(p)}
                              sx={{ p: 0.25 }}
                              // Read-only in this sprint (role edit is a follow-up).
                              readOnly
                            />
                            <Typography
                              variant="caption"
                              sx={{ fontFamily: 'monospace', fontSize: '0.65rem' }}
                              noWrap
                            >
                              {p}
                            </Typography>
                          </Stack>
                        ))}
                      </Box>
                    </Box>
                  );
                })}
              </Stack>
            </Box>
          </Stack>
        </Stack>
      ) : null}
    </Drawer>
  );
}

/** A labeled meta row. */
function MetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
      <Typography variant="body2" sx={{ minWidth: 110, color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ flex: 1 }} noWrap>
        {value}
      </Typography>
    </Box>
  );
}
