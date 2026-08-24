import { KeyRound, Lock, LogOut, ShieldCheck, ShieldOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  PageHeader,
  Skeleton,
  Tooltip,
} from '@/components/tailwind-ui';
import { useAuth } from '@/hooks/useAuth';

/**
 * ProfilePage — TailAdmin profile/settings pattern (Phase 2.6 redesign).
 *
 * Composition: identity banner (tinted band + overlapping avatar + roles +
 * actions) → account information (description list) → roles & permissions →
 * security (MFA, change-password link, sign out). All data is REAL from the
 * auth store; the edit affordance stays honest-disabled until identity lands
 * a self-service `PATCH /me`.
 */
export function ProfilePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  // Skeleton placeholder mirroring the loaded layout (banner + two cards) so
  // the page doesn't jump and never flashes a bare "loading" line.
  if (!user) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: role=status live region for the loading announcement.
      <div className="flex flex-col gap-4" role="status" aria-live="polite">
        <span className="sr-only">{t('common.loading')}</span>
        <PageHeader title={t('profile.title')} description={t('profile.subtitle')} />

        {/* Identity banner skeleton */}
        <Card flush className="overflow-hidden">
          <Skeleton className="h-24 w-full rounded-none" />
          <div className="flex items-end gap-4 px-5 pb-5">
            <Skeleton circle className="-mt-10 size-20 ring-4 ring-white dark:ring-graydark-200" />
            <div className="flex flex-col gap-2 pb-1">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-4 w-28" />
            </div>
          </div>
        </Card>

        {/* Account / security card skeletons */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="flex flex-col gap-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </Card>
          <Card className="flex flex-col gap-3">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </Card>
        </div>
      </div>
    );
  }

  const initials = (user.email || '?').charAt(0).toUpperCase();
  const displayName = user.email || t('profile.unknownUser');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('profile.title')} description={t('profile.subtitle')} />

      {/* ── Identity banner ── */}
      <Card flush className="overflow-hidden">
        <div className="h-24 border-b border-gray-100 bg-brand-500/10 dark:border-white/5 dark:bg-brand-500/15" />
        <div className="px-5 pb-5">
          <div className="-mt-10 flex flex-wrap items-end justify-between gap-4">
            <div className="flex min-w-0 items-end gap-4">
              <Avatar
                name={initials}
                className="size-20 text-2xl ring-4 ring-white dark:ring-graydark-200"
              />
              <div className="min-w-0 pb-1">
                <p className="truncate text-lg font-bold tracking-tight text-gray-900 dark:text-white">
                  {displayName}
                </p>
                <p className="text-sm text-gray-500 dark:text-graydark-600">
                  {t('profile.tenant')}: {user.tenantId}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pb-1">
              <Tooltip label={t('profile.editDisabledHelp')}>
                <Badge color="gray" className="cursor-not-allowed opacity-70">
                  <Lock size={12} aria-hidden />
                  {t('profile.editDisabled')}
                </Badge>
              </Tooltip>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<LogOut size={14} aria-hidden />}
                onClick={() => void logout()}
              >
                {t('common.logout')}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ── Account information ── */}
        <Card>
          <CardHeader title={t('profile.account')} icon={<KeyRound size={16} aria-hidden />} />
          <dl className="flex flex-col divide-y divide-gray-100 dark:divide-white/5">
            <DetailRow label={t('profile.userId')} value={user.id} mono />
            <DetailRow label={t('profile.email')} value={user.email || '—'} />
            <DetailRow label={t('profile.tenant')} value={user.tenantId} mono />
          </dl>
        </Card>

        {/* ── Security ── */}
        <Card>
          <CardHeader title={t('profile.security')} icon={<ShieldCheck size={16} aria-hidden />} />
          <div className="flex flex-col gap-4">
            <SecurityRow
              icon={<ShieldOff size={20} className="text-warning-500" aria-hidden />}
              label={t('profile.mfaStatus')}
              value={t('profile.mfaNotEnrolled')}
              help={t('profile.mfaNotEnforcedHelp')}
            />
            <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-white/5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-graydark-800">
                  {t('profile.changePassword')}
                </p>
                <p className="text-xs text-gray-500 dark:text-graydark-600">
                  {t('profile.changePasswordHelp')}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => navigate('/reset-password')}
              >
                {t('profile.changePasswordAction')}
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* ── Roles & permissions ── */}
      <Card>
        <CardHeader
          title={t('profile.rolesAndPermissions')}
          action={
            <span className="text-xs text-gray-500 tabular-nums dark:text-graydark-600">
              {user.roles.length} {t('profile.roles').toLowerCase()} · {user.permissions.length}{' '}
              {t('profile.permissions').toLowerCase()}
            </span>
          }
        />
        <div className="mb-4">
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-graydark-600">
            {t('profile.roles')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {user.roles.length > 0 ? (
              user.roles.map((role) => (
                <Badge key={role} color="brand">
                  {role}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-gray-500 dark:text-graydark-600">
                {t('profile.none')}
              </span>
            )}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-graydark-600">
            {t('profile.permissions')}
          </p>
          <div className="fv-scroll flex max-h-32 flex-wrap gap-1 overflow-y-auto">
            {user.permissions.length > 0 ? (
              user.permissions.map((perm) => (
                <Badge key={perm} color="gray">
                  {perm}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-gray-500 dark:text-graydark-600">
                {t('profile.noPermissions')}
              </span>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

/** Key/value detail row with optional monospace value (for IDs). */
function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-3 py-2.5 first:pt-0 last:pb-0">
      <dt className="w-40 shrink-0 text-sm text-gray-500 dark:text-graydark-600">{label}</dt>
      <dd
        className={`min-w-0 text-sm break-all text-gray-800 dark:text-graydark-800 ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </dd>
    </div>
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
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800 dark:text-graydark-800">{label}</p>
        <p className="text-sm text-gray-500 dark:text-graydark-600">{value}</p>
        <p className="text-xs text-gray-500 dark:text-graydark-600">{help}</p>
      </div>
    </div>
  );
}
