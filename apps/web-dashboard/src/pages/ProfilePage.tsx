import {
  Avatar,
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { Lock, ShieldOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/hooks/useAuth';

/**
 * ProfilePage — read-only account + security summary.
 *
 * Displays the principal profile from the auth store (id, email, tenant,
 * roles, permissions). Email comes from the login response (the backend
 * `GET /auth/me` currently returns `email: ""` — a known backend gap).
 *
 * The "Edit profile" affordance is intentionally disabled: identity-service has
 * no `PATCH /me` self-service endpoint yet (only admin `PUT /iam/users/:id`).
 * Rather than present a non-functional editable form, the page is honest about
 * the gap. MFA status reflects the backend's always-false `mfa_enabled` flag.
 */
export function ProfilePage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  if (!user) {
    return (
      <Box>
        <Typography color="text.secondary">{t('common.loading')}</Typography>
      </Box>
    );
  }

  const initials = (user.email || '?').charAt(0).toUpperCase();

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} sx={{ mb: 3 }}>
        {t('profile.title')}
      </Typography>

      {/* Identity card */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 3 }}>
            <Avatar sx={{ width: 64, height: 64, fontSize: '1.5rem', bgcolor: 'primary.main' }}>
              {initials}
            </Avatar>
            <Box>
              <Typography variant="h6" fontWeight={600}>
                {user.email || t('profile.unknownUser')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('profile.tenant')}: {user.tenantId}
              </Typography>
            </Box>
            <Box sx={{ flex: 1 }} />
            <Tooltip title={t('profile.editDisabledHelp')} arrow>
              <span>
                <Chip
                  icon={<Lock size={16} />}
                  label={t('profile.editDisabled')}
                  size="small"
                  color="default"
                  variant="outlined"
                  disabled
                />
              </span>
            </Tooltip>
          </Stack>

          <Divider sx={{ mb: 2 }} />

          <Stack spacing={1.5}>
            <DetailRow label={t('profile.userId')} value={user.id} mono />
            <DetailRow label={t('profile.email')} value={user.email || '—'} />
            <DetailRow label={t('profile.tenant')} value={user.tenantId} mono />
          </Stack>
        </CardContent>
      </Card>

      {/* Roles & permissions */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
            {t('profile.rolesAndPermissions')}
          </Typography>
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary">
              {t('profile.roles')}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap', gap: 1 }}>
              {user.roles.length > 0 ? (
                user.roles.map((role) => (
                  <Chip key={role} label={role} size="small" color="primary" variant="outlined" />
                ))
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {t('profile.none')}
                </Typography>
              )}
            </Stack>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t('profile.permissions')}
            </Typography>
            <Box
              sx={{
                mt: 0.5,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 0.5,
                maxHeight: 120,
                overflow: 'auto',
              }}
            >
              {user.permissions.length > 0 ? (
                user.permissions.map((perm) => (
                  <Chip key={perm} label={perm} size="small" variant="outlined" />
                ))
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {t('profile.noPermissions')}
                </Typography>
              )}
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* Security summary */}
      <Card>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
            {t('profile.security')}
          </Typography>
          <Stack spacing={2}>
            <SecurityRow
              icon={<ShieldOff size={20} color="var(--mui-palette-warning-main)" />}
              label={t('profile.mfaStatus')}
              value={t('profile.mfaNotEnforced')}
              help={t('profile.mfaNotEnforcedHelp')}
            />
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}

/** Key/value detail row with optional monospace value (for IDs). */
function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Stack direction="row" spacing={2} alignItems="baseline">
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120 }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ fontFamily: mono ? '"JetBrains Mono", monospace' : 'inherit', wordBreak: 'break-all' }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

/** Security summary row with icon + label + value + help text. */
function SecurityRow({
  icon,
  label,
  value,
  help,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  help: string;
}) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-start">
      <Box sx={{ mt: 0.25 }}>{icon}</Box>
      <Box>
        <Typography variant="body2" fontWeight={500}>
          {label}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {value}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {help}
        </Typography>
      </Box>
    </Stack>
  );
}
