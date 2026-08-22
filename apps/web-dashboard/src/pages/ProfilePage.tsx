import { Lock, ShieldOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Avatar, Badge, Card, PageHeader, Tooltip } from '@/components/tailwind-ui';
import { useAuth } from '@/hooks/useAuth';

/**
 * ProfilePage — TailAdmin read-only account + security summary (Phase 3 port).
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
    return <p className="text-sm text-gray-500 dark:text-graydark-600">{t('common.loading')}</p>;
  }

  const initials = (user.email || '?').charAt(0).toUpperCase();

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <PageHeader title={t('profile.title')} />

      {/* Identity card */}
      <Card>
        <div className="mb-4 flex items-center gap-4">
          <Avatar name={initials} size="lg" className="text-xl" />
          <div className="min-w-0">
            <p className="text-base font-semibold text-gray-900 dark:text-white">
              {user.email || t('profile.unknownUser')}
            </p>
            <p className="text-sm text-gray-500 dark:text-graydark-600">
              {t('profile.tenant')}: {user.tenantId}
            </p>
          </div>
          <div className="flex-1" />
          <Tooltip label={t('profile.editDisabledHelp')}>
            <Badge color="gray" className="cursor-not-allowed opacity-60">
              <Lock size={12} aria-hidden />
              {t('profile.editDisabled')}
            </Badge>
          </Tooltip>
        </div>

        <hr className="mb-4 border-gray-100 dark:border-white/5" />

        <div className="flex flex-col gap-2">
          <DetailRow label={t('profile.userId')} value={user.id} mono />
          <DetailRow label={t('profile.email')} value={user.email || '—'} />
          <DetailRow label={t('profile.tenant')} value={user.tenantId} mono />
        </div>
      </Card>

      {/* Roles & permissions */}
      <Card>
        <h2 className="mb-4 text-base font-semibold text-gray-900 dark:text-white">
          {t('profile.rolesAndPermissions')}
        </h2>
        <div className="mb-4">
          <p className="text-xs text-gray-500 dark:text-graydark-600">{t('profile.roles')}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
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
          <p className="text-xs text-gray-500 dark:text-graydark-600">{t('profile.permissions')}</p>
          <div className="mt-1 flex max-h-30 flex-wrap gap-1 overflow-y-auto">
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

      {/* Security summary */}
      <Card>
        <h2 className="mb-4 text-base font-semibold text-gray-900 dark:text-white">
          {t('profile.security')}
        </h2>
        <div className="flex flex-col gap-4">
          <SecurityRow
            icon={<ShieldOff size={20} className="text-warning-500" aria-hidden />}
            label={t('profile.mfaStatus')}
            value={t('profile.mfaNotEnforced')}
            help={t('profile.mfaNotEnforcedHelp')}
          />
        </div>
      </Card>
    </div>
  );
}

/** Key/value detail row with optional monospace value (for IDs). */
function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-3">
      <span className="min-w-30 text-sm text-gray-500 dark:text-graydark-600">{label}</span>
      <span
        className={`text-sm break-all text-gray-800 dark:text-graydark-800 ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </span>
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
      <div>
        <p className="text-sm font-medium text-gray-800 dark:text-graydark-800">{label}</p>
        <p className="text-sm text-gray-500 dark:text-graydark-600">{value}</p>
        <p className="text-xs text-gray-500 dark:text-graydark-600">{help}</p>
      </div>
    </div>
  );
}
