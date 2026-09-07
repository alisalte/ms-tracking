import {
  Building2,
  Camera,
  ImagePlus,
  KeyRound,
  LogOut,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react';
import { type ChangeEvent, type ReactNode, useEffect, useMemo } from 'react';
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
import { useProfileMedia } from '@/hooks/useProfileMedia';
import { isUuid } from '@/lib/ids';

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
 * Cover + overlapping portrait (uploadable), account description list,
 * security card, and roles/permissions. Name/email stay read-only until
 * identity lands a self-service PATCH /me; the photo lives locally per user.
 */
export function ProfilePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const tenant = useTenant();
  const rolesCatalog = useRoles();
  const media = useProfileMedia(user?.id);

  const tenantLabel =
    [tenant.data?.name, user?.tenantName, getTenantName(), user?.tenantId]
      .map((value) => value?.trim())
      .find((value): value is string => Boolean(value) && !isUuid(value)) ?? null;

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
          <Skeleton className="h-44 w-full rounded-none" />
          <div className="flex items-end gap-4 px-5 pb-5">
            <Skeleton circle className="-mt-14 size-32 ring-4 ring-white dark:ring-graydark-200" />
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
        <div className="relative h-44 overflow-hidden sm:h-52">
          {media.coverUrl ? (
            <img src={media.coverUrl} alt="" className="absolute inset-0 size-full object-cover" />
          ) : (
            <DefaultCover />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/15 to-black/5" />
          <div className="absolute end-3 top-3 flex gap-2">
            <PhotoPicker
              id="profile-cover-input"
              label={t('profile.changeCover')}
              disabled={media.busy}
              onFile={media.setCoverFile}
            >
              <ImagePlus size={14} aria-hidden />
              <span className="hidden sm:inline">{t('profile.changeCover')}</span>
            </PhotoPicker>
            {media.hasCustomCover && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="bg-white/90 backdrop-blur dark:bg-graydark-200/90"
                onClick={media.removeCover}
              >
                {t('profile.removeCover')}
              </Button>
            )}
          </div>
        </div>

        <div className="px-5 pb-6 sm:px-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex min-w-0 flex-col items-start gap-4 sm:flex-row sm:items-end">
              <div className="relative -mt-14 shrink-0 sm:-mt-16" data-testid="profile-portrait">
                <Avatar
                  name={displayName}
                  src={media.avatarUrl ?? undefined}
                  size="3xl"
                  className="shadow-xl ring-4 ring-white dark:ring-graydark-200"
                  data-testid="profile-portrait"
                />
                <PhotoPicker
                  id="profile-avatar-input"
                  label={t('profile.changePhoto')}
                  disabled={media.busy}
                  onFile={media.setAvatarFile}
                  className="absolute end-1 bottom-1 inline-flex size-9 cursor-pointer items-center justify-center rounded-full bg-brand-500 p-0 text-white shadow-md ring-2 ring-white hover:bg-brand-600 dark:ring-graydark-200"
                >
                  <Camera size={16} aria-hidden />
                </PhotoPicker>
              </div>
              <div className="min-w-0 pb-0.5">
                <p className="truncate text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                  {displayName}
                </p>
                <p
                  className="mt-0.5 truncate text-sm text-gray-500 dark:text-graydark-600"
                  dir="ltr"
                >
                  {email}
                </p>
                {tenantLabel && (
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-600 dark:text-graydark-700">
                    <Building2 size={14} className="shrink-0 text-brand-500" aria-hidden />
                    <span className="truncate">{tenantLabel}</span>
                  </p>
                )}
                {roleLabels.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {roleLabels.map((role) => (
                      <Badge key={role} color="brand">
                        {formatRoleLabel(role)}
                      </Badge>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-xs text-gray-400 dark:text-graydark-600">
                  {media.hasCustomAvatar ? t('profile.photoHint') : t('profile.addPhoto')}
                </p>
                {media.error && (
                  <p className="mt-1 text-xs text-warning-600 dark:text-warning-400">
                    {t(media.error)}
                  </p>
                )}
                {media.hasCustomAvatar && (
                  <button
                    type="button"
                    className="mt-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                    onClick={media.removeAvatar}
                  >
                    {t('profile.removePhoto')}
                  </button>
                )}
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<LogOut size={14} aria-hidden />}
              onClick={() => void logout()}
            >
              {t('common.logout')}
            </Button>
          </div>

          <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile label={t('profile.stats.organization')} value={tenantLabel || '—'} />
            <StatTile label={t('profile.stats.roles')} value={String(roleLabels.length)} />
            <StatTile
              label={t('profile.stats.permissions')}
              value={
                user.permissions.includes('*')
                  ? t('profile.allPermissions')
                  : String(user.permissions.length)
              }
            />
          </dl>
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

function DefaultCover() {
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-brand-400 via-brand-700 to-gray-950">
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 20%, rgba(255,255,255,.35) 0, transparent 42%), radial-gradient(circle at 85% 10%, rgba(255,255,255,.2) 0, transparent 36%)',
        }}
      />
      <svg
        className="absolute inset-0 size-full opacity-25"
        viewBox="0 0 800 220"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <title>Profile cover decoration</title>
        <path
          d="M-20 160 C 80 40, 180 200, 300 90 S 520 40, 640 130 S 820 40, 900 110"
          fill="none"
          stroke="white"
          strokeWidth="2"
        />
        <circle cx="300" cy="90" r="6" fill="white" />
        <circle cx="640" cy="130" r="6" fill="white" />
      </svg>
    </div>
  );
}

function PhotoPicker({
  id,
  label,
  disabled,
  onFile,
  className,
  children,
}: {
  id: string;
  label: string;
  disabled?: boolean;
  onFile: (file: File) => void;
  className?: string;
  children: ReactNode;
}) {
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onFile(file);
  };

  return (
    <label
      htmlFor={id}
      className={
        className ??
        'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-white/90 px-3 text-xs font-medium text-gray-800 shadow-sm backdrop-blur hover:bg-white dark:bg-graydark-200/90 dark:text-white'
      }
    >
      <input
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only"
        disabled={disabled}
        aria-label={label}
        onChange={onChange}
      />
      <span className="inline-flex items-center justify-center gap-1.5">{children}</span>
    </label>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 dark:border-white/5 dark:bg-white/5">
      <dt className="text-[11px] font-semibold tracking-wide text-gray-400 uppercase dark:text-graydark-600">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-semibold text-gray-900 dark:text-white">{value}</dd>
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
