import { KeyRound, Lock, LogOut, ShieldCheck, ShieldOff } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useRoles, useTenant } from '@/api/admin.api';
import { getTenantName, saveTenantName } from '@/auth/token.storage';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  PageHeader,
  Skeleton,
} from '@/components/tailwind-ui';
import { useAuth } from '@/hooks/useAuth';
import { displayLabel, isUuid } from '@/lib/ids';

function headingFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  if (!local) return email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function formatRoleLabel(role: string): string {
  return role.replace(/[-_]/g, ' ');
}

/**
 * ProfilePage — TailAdmin profile/settings pattern.
 *
 * Identity cover + overlapping avatar, account description list, security
 * card, and roles/permissions. Data is real from the auth store; the edit
 * control stays honest-disabled until identity lands a self-service PATCH /me.
 */
export function ProfilePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const tenant = useTenant();
  const rolesCatalog = useRoles();

  const tenantLabel = displayLabel(
    user?.tenantId,
    tenant.data?.name ?? user?.tenantName ?? getTenantName(),
  );

  useEffect(() => {
    if (tenant.data?.name) saveTenantName(tenant.data.name);
  }, [tenant.data?.name]);

  const roleLabels = useMemo(() => {
    if (!user) return [];
    const catalog = rolesCatalog.data ?? [];
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const role of user.roles) {
      const named = catalog.find((r) => r.id === role)?.name ?? (isUuid(role) ? null : role);
      if (!named || seen.has(named)) continue;
      seen.add(named);
      labels.push(named);
    }
    return labels;
  }, [user, rolesCatalog.data]);

  if (!user) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: role=status live region for the loading announcement.
      <div className="flex flex-col gap-5" role="status" aria-live="polite">
        <span className="sr-only">{t('common.loading')}</span>
        <PageHeader title={t('profile.title')} description={t('profile.subtitle')} />
        <Card flush className="overflow-hidden">
          <Skeleton className="h-28 w-full rounded-none" />
          <div className="flex items-end gap-4 px-5 pb-5">
            <Skeleton circle className="-mt-10 size-20 ring-4 ring-white dark:ring-graydark-200" />
            <div className="flex flex-col gap-2 pb-1">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-4 w-28" />
            </div>
          </div>
        </Card>
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

  const email = user.email || t('profile.unknownUser');
  const displayName = headingFromEmail(email);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('profile.title')} description={t('profile.subtitle')} />

      <Card flush className="overflow-hidden">
        <div className="relative h-28 bg-gradient-to-br from-brand-500 via-brand-600 to-brand-800">
          <div className="absolute -end-8 -top-10 size-40 rounded-full bg-white/10" />
          <div className="absolute -start-6 bottom-[-2rem] size-32 rounded-full bg-black/10" />
        </div>
        <div className="px-5 pb-5 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex min-w-0 items-end gap-4">
              <Avatar
                name={displayName}
                size="2xl"
                className="-mt-10 shadow-lg ring-4 ring-white dark:ring-graydark-200"
              />
              <div className="min-w-0 pb-0.5">
                <p className="truncate text-lg font-bold tracking-tight text-gray-900 dark:text-white">
                  {displayName}
                </p>
                <p className="truncate text-sm text-gray-500 dark:text-graydark-600" dir="ltr">
                  {email}
                </p>
                {roleLabels.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {roleLabels.map((role) => (
                      <Badge key={role} color="brand">
                        {formatRoleLabel(role)}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:pb-0.5">
              <Button
                variant="outline"
                size="sm"
                disabled
                title={t('profile.editDisabledHelp')}
                leftIcon={<Lock size={14} aria-hidden />}
              >
                {t('profile.editDisabled')}
              </Button>
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
        <Card>
          <CardHeader title={t('profile.account')} icon={<KeyRound size={16} aria-hidden />} />
          <dl className="flex flex-col divide-y divide-gray-100 dark:divide-white/5">
            <DetailRow label={t('profile.email')} value={user.email || '—'} mono />
            {tenantLabel && <DetailRow label={t('profile.tenant')} value={tenantLabel} />}
          </dl>
        </Card>

        <Card>
          <CardHeader title={t('profile.security')} icon={<ShieldCheck size={16} aria-hidden />} />
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-400">
                <ShieldOff size={18} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-gray-800 dark:text-graydark-800">
                    {t('profile.mfaStatus')}
                  </p>
                  <Badge color="warning">{t('profile.mfaNotEnrolled')}</Badge>
                </div>
                <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-graydark-600">
                  {t('profile.mfaNotEnforcedHelp')}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-white/5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-graydark-800">
                  {t('profile.changePassword')}
                </p>
                <p className="text-xs leading-5 text-gray-500 dark:text-graydark-600">
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

      <Card>
        <CardHeader
          title={t('profile.rolesAndPermissions')}
          action={
            <span className="text-xs text-gray-500 tabular-nums dark:text-graydark-600">
              {t('profile.rolePermCount', {
                roles: roleLabels.length,
                permissions: user.permissions.length,
              })}
            </span>
          }
        />
        <div className="mb-5">
          <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-gray-400 uppercase dark:text-graydark-600">
            {t('profile.roles')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {roleLabels.length > 0 ? (
              roleLabels.map((role) => (
                <Badge key={role} color="brand">
                  {formatRoleLabel(role)}
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
          <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-gray-400 uppercase dark:text-graydark-600">
            {t('profile.permissions')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {user.permissions.length > 0 ? (
              user.permissions.map((perm) =>
                perm === '*' ? (
                  <Badge key={perm} color="brand">
                    {t('profile.allPermissions')}
                  </Badge>
                ) : (
                  <Badge key={perm} color="gray" className="font-mono">
                    {perm}
                  </Badge>
                ),
              )
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

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[9rem_auto] sm:items-baseline sm:gap-x-4">
      <dt className="text-sm text-gray-500 dark:text-graydark-600">{label}</dt>
      <dd
        dir={mono ? 'ltr' : undefined}
        className={`min-w-0 justify-self-start text-sm break-all text-gray-800 dark:text-graydark-800 ${
          mono ? 'font-mono' : ''
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
