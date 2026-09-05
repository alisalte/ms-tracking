/**
 * NotificationCenterPage — TailAdmin notification history + preferences
 * (Sprint H, Phase 6 port).
 *
 * - Server-side filtered, cursor-paginated history (type/severity/unread +
 *   date range), synced to the URL like the Alarm Center.
 * - Detail drawer with the delivery attempts timeline per channel — status is
 *   shown honestly (SENT ≠ Delivered; Unread/Read for in-app).
 * - Preferences matrix: category × channel with unavailable channels (SMS /
 *   push — no provider configured) visibly disabled.
 * - Real-time: new notifications arrive via WS and update caches
 *   incrementally (the bell hook shares the query cache).
 */
import { CheckCheck, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import {
  useChannelHealth,
  useMarkAllAsRead,
  useMarkAsRead,
  useNotificationDetail,
  useNotificationPreferences,
  useNotificationsPage,
  useUpdatePreferences,
} from '@/api/notification.api';
import { ErrorState } from '@/components/common/ErrorState';
import { Button, Card, PageHeader, Spinner, Tooltip } from '@/components/tailwind-ui';
import {
  localizeEventType,
  localizeNotificationBody,
  localizeNotificationTitle,
} from '@/lib/alarm-copy';
import { relativeTime } from '@/lib/relative-time';
import type { Notification, NotificationChannel } from '@/types/notification.types';

const EVENT_TYPES = [
  'overspeed',
  'geofence_enter',
  'geofence_exit',
  'geofence_dwell',
  'device_offline',
  'device_online',
  'prolonged_idle',
  'parking',
  'low_battery',
  'ignition_on',
  'ignition_off',
  'trip_started',
  'trip_ended',
  'excessive_trip_duration',
  'excessive_stop_duration',
  'sos',
  'dms',
  'geofence',
  'fuel-theft',
  'camera',
  'collision',
  'temperature',
  'offline',
  'idle',
  'ignition',
  'battery',
  'tow',
  'power',
  'jamming',
  'other',
] as const;

const SEVERITIES = ['critical', 'high', 'normal', 'low'] as const;

/** Channels shown in the preferences matrix, in display order. */
const PREFERENCE_CHANNELS: NotificationChannel[] = ['in_app', 'websocket', 'email', 'sms', 'push'];

/** Severity → Tailwind badge classes for the notification chips. */
function severityTone(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-400';
    case 'high':
      return 'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-400';
    case 'normal':
      return 'bg-info-50 text-info-700 dark:bg-info-500/10 dark:text-info-400';
    default:
      return 'bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-graydark-700';
  }
}

export function NotificationCenterPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<'history' | 'preferences'>('history');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const eventType = searchParams.get('eventType') ?? undefined;
  const severity = searchParams.get('severity') ?? undefined;
  const unreadOnly = searchParams.get('unreadOnly') === 'true';
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;

  const setFilter = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const page = useNotificationsPage({ eventType, severity, unreadOnly, from, to });
  const detail = useNotificationDetail(selectedId);
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();

  // ESC closes the detail drawer.
  useEffect(() => {
    if (!selectedId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedId(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedId]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <PageHeader
        title={t('notifications.center.title', { defaultValue: 'Notification Center' })}
        description={t('notifications.center.subtitle', {
          defaultValue: 'Alarm-driven notifications, delivery status, and your preferences',
        })}
        actions={
          <>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<RefreshCw size={14} />}
              onClick={() => page.refetch()}
              disabled={page.isLoading}
            >
              {t('common.refresh', { defaultValue: 'Refresh' })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              leftIcon={<CheckCheck size={14} />}
              onClick={() => markAllAsRead.mutate()}
              disabled={markAllAsRead.isPending}
            >
              {t('notifications.markAllRead', { defaultValue: 'Mark all read' })}
            </Button>
          </>
        }
      />

      {/* Tabs */}
      <div
        role="tablist"
        className="flex w-fit items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1 dark:border-white/5 dark:bg-white/5"
      >
        {(
          [
            {
              id: 'history',
              label: t('notifications.center.history', { defaultValue: 'History' }),
            },
            {
              id: 'preferences',
              label: t('notifications.center.preferences', { defaultValue: 'Preferences' }),
            },
          ] as const
        ).map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`cursor-pointer rounded-lg border-none px-4 py-1.5 text-sm font-semibold transition-colors ${
              tab === id
                ? 'bg-white text-gray-900 shadow-sm dark:bg-graydark-300 dark:text-white'
                : 'bg-transparent text-gray-500 hover:text-gray-800 dark:text-graydark-600 dark:hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'preferences' ? (
        <PreferencesPanel />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Filter bar — synced to the URL */}
          <Card className="flex flex-wrap items-center gap-3 p-3">
            <select
              value={eventType ?? ''}
              onChange={(e) => setFilter('eventType', e.target.value || null)}
              aria-label={t('notifications.center.filters.type', { defaultValue: 'Type' })}
              className="h-9 cursor-pointer rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
            >
              <option value="">{t('common.all', { defaultValue: 'All' })}</option>
              {EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {localizeEventType(t, type)}
                </option>
              ))}
            </select>
            <select
              value={severity ?? ''}
              onChange={(e) => setFilter('severity', e.target.value || null)}
              aria-label={t('notifications.center.filters.severity', { defaultValue: 'Severity' })}
              className="h-9 cursor-pointer rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
            >
              <option value="">{t('common.all', { defaultValue: 'All' })}</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {t(`notifications.severity.${s}`, { defaultValue: s })}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-graydark-700">
              <span className="sr-only">
                {t('notifications.center.filters.from', { defaultValue: 'From' })}
              </span>
              <input
                type="date"
                value={from ?? ''}
                onChange={(e) => setFilter('from', e.target.value || null)}
                aria-label={t('notifications.center.filters.from', { defaultValue: 'From' })}
                className="h-9 rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-graydark-700">
              <span className="sr-only">
                {t('notifications.center.filters.to', { defaultValue: 'To' })}
              </span>
              <input
                type="date"
                value={to ?? ''}
                onChange={(e) => setFilter('to', e.target.value || null)}
                aria-label={t('notifications.center.filters.to', { defaultValue: 'To' })}
                className="h-9 rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
              />
            </label>
            {/* Unread-only switch */}
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-graydark-700">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => setFilter('unreadOnly', e.target.checked ? 'true' : null)}
                className="size-4 rounded border-gray-300 accent-brand-500"
              />
              {t('notifications.center.filters.unreadOnly', { defaultValue: 'Unread only' })}
            </label>
          </Card>

          {/* History list */}
          <Card flush>
            {page.isLoading ? (
              <div className="flex justify-center py-10">
                <Spinner size="md" label={t('common.loading')} />
              </div>
            ) : page.isError ? (
              <ErrorState error={page.error} onRetry={() => page.refetch()} />
            ) : page.items.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-500 dark:text-graydark-600">
                {t('notifications.empty', { defaultValue: 'No notifications' })}
              </p>
            ) : (
              <ul className="m-0 list-none p-0">
                {page.items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(n.id);
                        if (!n.read) markAsRead.mutate(n.id);
                      }}
                      className={`flex w-full cursor-pointer flex-col gap-1 border-b border-gray-100 px-5 py-3 text-start transition-colors last:border-b-0 hover:bg-gray-50 dark:border-white/5 dark:hover:bg-white/5 ${
                        n.read ? 'bg-transparent' : 'bg-gray-50 dark:bg-white/5'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={`min-w-0 flex-1 truncate text-sm ${
                            n.read
                              ? 'font-normal text-gray-700 dark:text-graydark-700'
                              : 'font-semibold text-gray-900 dark:text-white'
                          }`}
                        >
                          {localizeNotificationTitle(t, n)}
                        </span>
                        <span
                          className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[0.7rem] font-semibold ${severityTone(n.severity)}`}
                        >
                          {t(`notifications.severity.${n.severity}`, { defaultValue: n.severity })}
                        </span>
                        <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-gray-300 px-2 text-[0.7rem] font-medium text-gray-600 dark:border-white/10 dark:text-graydark-700">
                          {localizeEventType(t, n.eventType)}
                        </span>
                      </span>
                      <span className="flex min-w-0 items-center gap-1.5 text-xs">
                        <span className="min-w-0 truncate text-gray-500 dark:text-graydark-600">
                          {localizeNotificationBody(t, n)}
                        </span>
                        {' · '}
                        <span className="shrink-0 text-gray-400 dark:text-graydark-600">
                          {relativeTime(n.createdAt, t)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {page.hasNextPage && (
              <div className="border-t border-gray-200 p-2 text-center dark:border-white/5">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={page.fetchNextPage}
                  disabled={page.isFetchingNextPage}
                >
                  {page.isFetchingNextPage
                    ? t('common.loading', { defaultValue: 'Loading…' })
                    : t('common.loadMore', { defaultValue: 'Load more' })}
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Detail drawer with delivery timeline */}
      {selectedId && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            tabIndex={-1}
            aria-label={t('common.close')}
            onClick={() => setSelectedId(null)}
            className="absolute inset-0 cursor-default bg-gray-900/40"
          />
          <aside
            className="absolute inset-y-0 end-0 w-full max-w-105 overflow-y-auto bg-white p-5 shadow-2xl dark:bg-graydark-300"
            data-testid="notification-detail-drawer"
          >
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                aria-label={t('common.close')}
                className="cursor-pointer rounded-lg border-none bg-transparent p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/5 dark:hover:text-white"
              >
                <X size={17} />
              </button>
            </div>
            {detail.isLoading || !detail.data ? (
              <div className="flex justify-center py-10">
                <Spinner size="md" label={t('common.loading')} />
              </div>
            ) : (
              <NotificationDetailContent
                notification={detail.data as Notification}
                deliveries={detail.data.deliveries ?? []}
              />
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function NotificationDetailContent({
  notification,
  deliveries,
}: {
  notification: Notification;
  deliveries: NonNullable<ReturnType<typeof useNotificationDetail>['data']>['deliveries'];
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white">
        {localizeNotificationTitle(t, notification)}
      </h2>
      <p className="text-sm text-gray-500 dark:text-graydark-600">
        {localizeNotificationBody(t, notification)}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <span
          className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold ${severityTone(notification.severity)}`}
        >
          {t(`notifications.severity.${notification.severity}`, {
            defaultValue: notification.severity,
          })}
        </span>
        <span className="inline-flex h-6 items-center rounded-full border border-gray-300 px-2.5 text-xs font-medium text-gray-600 dark:border-white/10 dark:text-graydark-700">
          {localizeEventType(t, notification.eventType)}
        </span>
        <span className="inline-flex h-6 items-center rounded-full border border-gray-300 px-2.5 text-xs font-medium text-gray-600 dark:border-white/10 dark:text-graydark-700">
          {notification.read ? t('notifications.status.READ') : t('notifications.status.UNREAD')}
        </span>
      </div>
      <p className="text-xs text-gray-400 dark:text-graydark-600">
        {notification.createdAt && !Number.isNaN(new Date(notification.createdAt).getTime())
          ? new Date(notification.createdAt).toLocaleString()
          : '—'}
        {notification.vehicleId ? ` · ${notification.vehicleId}` : ''}
      </p>

      <div className="border-t border-gray-200 dark:border-white/5" />
      <p className="text-sm font-semibold text-gray-800 dark:text-white">
        {t('notifications.center.deliveries', { defaultValue: 'Delivery attempts' })}
      </p>
      {deliveries.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-graydark-600">
          {t('notifications.center.noDeliveries', {
            defaultValue: 'No delivery attempts recorded',
          })}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {deliveries.map((d) => (
            <li key={d.id} className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex h-6 items-center rounded-full border border-gray-300 px-2.5 text-xs font-medium text-gray-600 dark:border-white/10 dark:text-graydark-700">
                  {t(`notifications.channel.${d.channel}`, { defaultValue: d.channel })}
                </span>
                <span
                  className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold ${
                    d.status === 'SENT' || d.status === 'DELIVERED' || d.status === 'READ'
                      ? 'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-400'
                      : d.status === 'FAILED'
                        ? 'bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-400'
                        : 'bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-graydark-700'
                  }`}
                >
                  {t(`notifications.status.${d.status}`, { defaultValue: d.status })}
                </span>
                {d.attempts > 1 && (
                  <span className="text-xs text-gray-400 dark:text-graydark-600">
                    {t('notifications.center.attempts', {
                      defaultValue: '{{count}} attempts',
                      count: d.attempts,
                    })}
                  </span>
                )}
              </span>
              {d.error ? (
                <span className="text-xs text-danger-600 dark:text-danger-400">{d.error}</span>
              ) : d.provider ? (
                <span className="text-xs text-gray-400 dark:text-graydark-600">
                  {d.provider}
                  {d.providerMessageId ? ` · ${d.providerMessageId}` : ''}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PreferencesPanel() {
  const { t } = useTranslation();
  const { data: preferences } = useNotificationPreferences();
  const { data: channelHealth } = useChannelHealth();
  const updatePreference = useUpdatePreferences();

  const healthByChannel = new Map((channelHealth ?? []).map((h) => [h.channel, h.status]));
  const categories = ['alarm'] as const; // the only category dispatched today

  const prefFor = (category: string) =>
    (preferences ?? []).find((p) => p.category === category) ?? {
      category,
      minSeverity: 'normal' as const,
      channels: ['in_app', 'websocket'] as NotificationChannel[],
      enabled: true,
    };

  const toggleChannel = (category: string, channel: NotificationChannel, enabled: boolean) => {
    const pref = prefFor(category);
    const channels = new Set(pref.channels);
    if (enabled) channels.add(channel);
    else channels.delete(channel);
    updatePreference.mutate({ category, channels: [...channels] });
  };

  return (
    <Card className="flex flex-col gap-5 p-5">
      <p className="text-sm text-gray-500 dark:text-graydark-600">
        {t('notifications.preferences.hint', {
          defaultValue:
            'Choose how you are notified. Email requires a configured provider; SMS and push are unavailable until providers are configured.',
        })}
      </p>
      {categories.map((category) => {
        const pref = prefFor(category);
        return (
          <div key={category}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-gray-800 capitalize dark:text-white">
                {t(`notifications.category.${category}`, { defaultValue: category })}
              </p>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-graydark-700">
                <input
                  type="checkbox"
                  checked={pref.enabled}
                  onChange={(e) => updatePreference.mutate({ category, enabled: e.target.checked })}
                  className="size-4 rounded border-gray-300 accent-brand-500"
                />
                {t('notifications.preferences.enabled', { defaultValue: 'Enabled' })}
              </label>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {PREFERENCE_CHANNELS.map((channel) => {
                const health = healthByChannel.get(channel);
                const available = health !== 'DISABLED';
                const checked = pref.channels.includes(channel);
                return available ? (
                  <label
                    key={channel}
                    className="flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-graydark-700"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleChannel(category, channel, e.target.checked)}
                      disabled={updatePreference.isPending}
                      className="size-4 rounded border-gray-300 accent-brand-500"
                    />
                    {t(`notifications.channel.${channel}`, { defaultValue: channel })}
                  </label>
                ) : (
                  <Tooltip
                    key={channel}
                    label={t('notifications.preferences.channelUnavailable', {
                      defaultValue: 'Not configured — unavailable',
                    })}
                  >
                    <label className="flex items-center gap-2 text-sm text-gray-400 dark:text-graydark-600">
                      <input
                        type="checkbox"
                        checked={false}
                        disabled
                        className="size-4 accent-brand-500"
                      />
                      {t(`notifications.channel.${channel}`, { defaultValue: channel })}
                    </label>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        );
      })}
    </Card>
  );
}
