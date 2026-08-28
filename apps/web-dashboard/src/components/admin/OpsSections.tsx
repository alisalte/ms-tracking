/**
 * Notifications, policies, and integrations — live channel/preference/
 * geofence-alert data plus honest empty cards for domains that have no
 * service in this stack (HOS, SSO, SCIM).
 */
import { Bell, Plug, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useGeofences } from '@/api/geofence.api';
import {
  useChannelHealth,
  useNotificationPreferences,
  useNotifications,
} from '@/api/notification.api';
import { AdminPageLink } from '@/components/admin/admin-meta';
import { ErrorState } from '@/components/common/ErrorState';
import {
  Badge,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  type TableColumn,
  Toolbar,
} from '@/components/tailwind-ui';
import { relativeTime } from '@/lib/relative-time';
import type { Geofence } from '@/types/geofence.types';
import type {
  ChannelHealth,
  Notification,
  NotificationPreference,
} from '@/types/notification.types';

export function NotificationsSection() {
  const { t } = useTranslation();
  const list = useNotifications({ limit: 25 });
  const channels = useChannelHealth();

  const columns: Array<TableColumn<Notification>> = [
    {
      id: 'title',
      headerKey: 'admin.notifications.colTitle',
      sortBy: (n) => n.title,
      render: (n) => <span className="font-medium">{n.title || n.eventType}</span>,
    },
    { id: 'severity', headerKey: 'admin.notifications.colSeverity', render: (n) => n.severity },
    {
      id: 'read',
      headerKey: 'admin.notifications.colRead',
      render: (n) => (n.read ? t('admin.notifications.read') : t('admin.notifications.unread')),
    },
    {
      id: 'when',
      headerKey: 'admin.audit.colTime',
      align: 'end',
      render: (n) => (
        <span className="text-xs text-gray-500 dark:text-graydark-600">
          {relativeTime(n.createdAt, t)}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        left={<h2 className="text-sm font-semibold">{t('admin.nav.notifications')}</h2>}
        right={<AdminPageLink to="/notifications" label={t('admin.openFullPage')} />}
      />
      <ChannelHealthCards channels={channels.data ?? []} loading={channels.isLoading} />
      <DataTable
        rows={list.data ?? []}
        columns={columns}
        rowKey={(n) => n.id}
        loading={list.isLoading}
        maxHeight="calc(100vh - 360px)"
        errorState={
          list.error ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : undefined
        }
        emptyState={
          <EmptyState
            icon={<Bell />}
            title={t('admin.empty')}
            description={t('admin.notifications.empty')}
          />
        }
      />
    </div>
  );
}

export function PoliciesSection() {
  const { t } = useTranslation();
  const geofences = useGeofences();
  const prefs = useNotificationPreferences();

  const geoCols: Array<TableColumn<Geofence>> = [
    {
      id: 'name',
      headerKey: 'admin.geofences.colName',
      sortBy: (g) => g.name,
      render: (g) => <span className="font-medium">{g.name}</span>,
    },
    {
      id: 'alerts',
      headerKey: 'admin.geofences.colAlerts',
      render: (g) => g.alertOn.join(', ') || '—',
    },
    {
      id: 'status',
      headerKey: 'admin.users.colStatus',
      render: (g) => (
        <Badge color={g.status === 'ACTIVE' ? 'success' : 'gray'} dot>
          {g.status}
        </Badge>
      ),
    },
  ];

  const prefCols: Array<TableColumn<NotificationPreference>> = [
    {
      id: 'category',
      headerKey: 'admin.policies.colCategory',
      render: (p) => p.category,
    },
    { id: 'severity', headerKey: 'admin.notifications.colSeverity', render: (p) => p.minSeverity },
    {
      id: 'channels',
      headerKey: 'admin.policies.colChannels',
      render: (p) => p.channels.join(', '),
    },
    {
      id: 'enabled',
      headerKey: 'admin.users.colStatus',
      render: (p) => (
        <Badge color={p.enabled ? 'success' : 'gray'} dot>
          {p.enabled ? t('admin.users.status.active') : t('admin.users.status.deactivated')}
        </Badge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section>
        <Toolbar
          left={<h2 className="text-sm font-semibold">{t('admin.policies.geofenceAlerts')}</h2>}
          right={<AdminPageLink to="/geofences" label={t('admin.openFullPage')} />}
        />
        <DataTable
          rows={geofences.data ?? []}
          columns={geoCols}
          rowKey={(g) => g.id}
          loading={geofences.isLoading}
          maxHeight="280px"
          errorState={
            geofences.error ? (
              <ErrorState error={geofences.error} onRetry={() => void geofences.refetch()} />
            ) : undefined
          }
          emptyState={<EmptyState icon={<Shield />} title={t('admin.empty')} />}
        />
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold">{t('admin.policies.notificationPrefs')}</h2>
        <DataTable
          rows={prefs.data ?? []}
          columns={prefCols}
          rowKey={(p) => p.category}
          loading={prefs.isLoading}
          maxHeight="240px"
          errorState={
            prefs.error ? (
              <ErrorState error={prefs.error} onRetry={() => void prefs.refetch()} />
            ) : undefined
          }
          emptyState={
            <EmptyState title={t('admin.empty')} description={t('admin.policies.prefsEmpty')} />
          }
        />
      </section>
      <EmptyState
        icon={<Shield />}
        title={t('admin.policies.hosTitle')}
        description={t('admin.policies.hosBody')}
      />
    </div>
  );
}

export function IntegrationsSection() {
  const { t } = useTranslation();
  const channels = useChannelHealth();

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        left={<h2 className="text-sm font-semibold">{t('admin.nav.integrations')}</h2>}
        right={<AdminPageLink to="/admin?section=apikeys" label={t('admin.nav.apikeys')} />}
      />
      {channels.error ? (
        <ErrorState error={channels.error} onRetry={() => void channels.refetch()} />
      ) : (
        <ChannelHealthCards channels={channels.data ?? []} loading={channels.isLoading} />
      )}
      <Card>
        <CardHeader title={t('admin.integrations.ssoTitle')} icon={<Plug />} />
        <p className="text-sm text-gray-600 dark:text-graydark-700">
          {t('admin.integrations.ssoBody')}
        </p>
      </Card>
      <Card>
        <CardHeader title={t('admin.integrations.scimTitle')} />
        <p className="text-sm text-gray-600 dark:text-graydark-700">
          {t('admin.integrations.scimBody')}
        </p>
      </Card>
    </div>
  );
}

function ChannelHealthCards({
  channels,
  loading,
}: {
  channels: ChannelHealth[];
  loading: boolean;
}) {
  const { t } = useTranslation();
  if (loading) return null;
  if (channels.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-graydark-600">
        {t('admin.integrations.channelsEmpty')}
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {channels.map((c) => (
        <Card key={c.channel}>
          <p className="text-xs text-gray-500 dark:text-graydark-600">{c.channel}</p>
          <p className="mt-0.5 text-sm font-medium">{c.provider}</p>
          <Badge
            className="mt-2"
            color={
              c.status === 'CONFIGURED' ? 'success' : c.status === 'DISABLED' ? 'gray' : 'warning'
            }
            dot
          >
            {c.status}
          </Badge>
        </Card>
      ))}
    </div>
  );
}
