/**
 * UserDetailDrawer — right slide-over showing a user's profile + role bindings
 * + status actions (IAM §5.1). Selection → detail pattern (UI_UX §0.6).
 */
import { ShieldCheck, UserCog, UserX } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserDetail, useUserStatusAction } from '@/api/admin.api';
import { userStatusColor } from '@/components/admin/admin-meta';
import type { AdminUserStatus } from '@/types/admin.types';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';

const DRAWER_WIDTH = 400;

interface UserDetailDrawerProps {
  userId: string | null;
  onClose: () => void;
}

export function UserDetailDrawer({ userId, onClose }: UserDetailDrawerProps) {
  const { t } = useTranslation();
  const { data: user, isLoading } = useUserDetail(userId);
  const action = useUserStatusAction();

  return (
    <Drawer
      anchor="right"
      open={Boolean(userId)}
      onClose={onClose}
      variant="temporary"
      sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH, maxWidth: '100vw' } }}
    >
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : user ? (
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
                {user.firstName} {user.lastName}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {user.email}
              </Typography>
            </Box>
            <Chip
              size="small"
              label={t(`admin.users.status.${user.status}`)}
              sx={{
                height: 22,
                fontSize: '0.72rem',
                fontWeight: 600,
                color: '#fff',
                bgcolor: userStatusColor(user.status),
              }}
            />
            <IconButton onClick={onClose} aria-label={t('common.close')} size="small">
              ✕
            </IconButton>
          </Stack>

          <Stack gap={2} sx={{ p: 2 }}>
            {/* Profile meta */}
            <Box>
              <MetaRow label={t('admin.users.username')} value={user.username} />
              <MetaRow label={t('admin.users.role')} value={user.roleName} />
              <MetaRow
                label={t('admin.users.authProvider')}
                value={t(`admin.users.provider.${user.authProvider}`)}
              />
              <MetaRow
                label={t('admin.users.mfa')}
                value={user.mfaEnabled ? t('admin.users.mfaOn') : t('admin.users.mfaOff')}
              />
              {user.lastLoginAt && (
                <MetaRow
                  label={t('admin.users.colLastLogin')}
                  value={new Date(user.lastLoginAt).toLocaleString()}
                />
              )}
              <MetaRow
                label={t('admin.users.created')}
                value={new Date(user.createdAt).toLocaleDateString()}
              />
            </Box>

            <Divider />

            {/* Status actions (IAM §5.1 PATCH /users/{id}/status) */}
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
              >
                {t('admin.users.actions')}
              </Typography>
              <Stack direction="row" gap={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
                {user.status === 'active' && (
                  <Button
                    size="small"
                    variant="outlined"
                    color="warning"
                    startIcon={<UserX size={14} />}
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({ id: user.id, status: 'suspended' as AdminUserStatus })
                    }
                  >
                    {t('admin.users.suspend')}
                  </Button>
                )}
                {(user.status === 'suspended' || user.status === 'locked') && (
                  <Button
                    size="small"
                    variant="contained"
                    color="success"
                    startIcon={<ShieldCheck size={14} />}
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({ id: user.id, status: 'active' as AdminUserStatus })
                    }
                  >
                    {t('admin.users.activate')}
                  </Button>
                )}
                {user.status !== 'deactivated' && (
                  <Button
                    size="small"
                    variant="text"
                    color="error"
                    startIcon={<UserCog size={14} />}
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({ id: user.id, status: 'deactivated' as AdminUserStatus })
                    }
                  >
                    {t('admin.users.deactivate')}
                  </Button>
                )}
              </Stack>
            </Box>
          </Stack>
        </Stack>
      ) : (
        <Box sx={{ p: 4 }}>
          <Typography color="text.secondary">{t('admin.users.notFound')}</Typography>
        </Box>
      )}
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
