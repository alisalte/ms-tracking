/**
 * NotificationCenterPage — full notification history + preferences (Sprint H).
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
import { CheckCheck, RefreshCw } from 'lucide-react';
import { useState } from 'react';
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
import { PageHeader } from '@/components/ui/PageHeader';
import { useNotificationRealtime } from '@/hooks/useNotificationRealtime';
import { relativeTime } from '@/lib/relative-time';
import type { Notification, NotificationChannel } from '@/types/notification.types';
import {
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  FormControlLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';

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
] as const;

const SEVERITIES = ['critical', 'high', 'normal', 'low'] as const;

/** Channels shown in the preferences matrix, in display order. */
const PREFERENCE_CHANNELS: NotificationChannel[] = ['in_app', 'websocket', 'email', 'sms', 'push'];

function severityColor(severity: string): 'error' | 'warning' | 'info' | 'default' {
  switch (severity) {
    case 'critical':
      return 'error';
    case 'high':
      return 'warning';
    case 'normal':
      return 'info';
    default:
      return 'default';
  }
}

export function NotificationCenterPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<'history' | 'preferences'>('history');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Realtime push (shared query cache with the bell).
  useNotificationRealtime();

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

  return (
    <Box>
      <PageHeader
        title={t('notifications.center.title', { defaultValue: 'Notification Center' })}
        subtitle={t('notifications.center.subtitle', {
          defaultValue: 'Alarm-driven notifications, delivery status, and your preferences',
        })}
        actions={
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              startIcon={<RefreshCw size={14} />}
              onClick={() => page.refetch()}
              disabled={page.isLoading}
            >
              {t('common.refresh', { defaultValue: 'Refresh' })}
            </Button>
            <Button
              size="small"
              startIcon={<CheckCheck size={14} />}
              onClick={() => markAllAsRead.mutate()}
              disabled={markAllAsRead.isPending}
            >
              {t('notifications.markAllRead', { defaultValue: 'Mark all read' })}
            </Button>
          </Stack>
        }
      />

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab
          value="history"
          label={t('notifications.center.history', { defaultValue: 'History' })}
        />
        <Tab
          value="preferences"
          label={t('notifications.center.preferences', { defaultValue: 'Preferences' })}
        />
      </Tabs>

      {tab === 'preferences' ? (
        <PreferencesPanel />
      ) : (
        <Stack spacing={2}>
          {/* Filter bar — synced to the URL */}
          <Card sx={{ p: 1.5 }}>
            <Stack direction="row" flexWrap="wrap" gap={1.5} alignItems="center">
              <TextField
                select
                size="small"
                label={t('notifications.center.filters.type', { defaultValue: 'Type' })}
                value={eventType ?? ''}
                onChange={(e) => setFilter('eventType', e.target.value || null)}
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="">{t('common.all', { defaultValue: 'All' })}</MenuItem>
                {EVENT_TYPES.map((type) => (
                  <MenuItem key={type} value={type}>
                    {t(`notifications.eventTypes.${type}`, {
                      defaultValue: type.replace(/_/g, ' '),
                    })}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                size="small"
                label={t('notifications.center.filters.severity', { defaultValue: 'Severity' })}
                value={severity ?? ''}
                onChange={(e) => setFilter('severity', e.target.value || null)}
                sx={{ minWidth: 140 }}
              >
                <MenuItem value="">{t('common.all', { defaultValue: 'All' })}</MenuItem>
                {SEVERITIES.map((s) => (
                  <MenuItem key={s} value={s}>
                    {t(`notifications.severity.${s}`, { defaultValue: s })}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                type="date"
                size="small"
                label={t('notifications.center.filters.from', { defaultValue: 'From' })}
                value={from ?? ''}
                onChange={(e) => setFilter('from', e.target.value || null)}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ minWidth: 150 }}
              />
              <TextField
                type="date"
                size="small"
                label={t('notifications.center.filters.to', { defaultValue: 'To' })}
                value={to ?? ''}
                onChange={(e) => setFilter('to', e.target.value || null)}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ minWidth: 150 }}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={unreadOnly}
                    onChange={(e) => setFilter('unreadOnly', e.target.value ? 'true' : null)}
                    size="small"
                  />
                }
                label={t('notifications.center.filters.unreadOnly', {
                  defaultValue: 'Unread only',
                })}
              />
            </Stack>
          </Card>

          {/* History list */}
          <Card>
            {page.isLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress size={28} />
              </Box>
            ) : page.isError ? (
              <ErrorState error={page.error} onRetry={() => page.refetch()} />
            ) : page.items.length === 0 ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ textAlign: 'center', py: 6 }}
              >
                {t('notifications.empty', { defaultValue: 'No notifications' })}
              </Typography>
            ) : (
              <List dense>
                {page.items.map((n) => (
                  <ListItemButton
                    key={n.id}
                    onClick={() => {
                      setSelectedId(n.id);
                      if (!n.read) markAsRead.mutate(n.id);
                    }}
                    sx={{ bgcolor: n.read ? 'transparent' : 'action.hover' }}
                  >
                    <ListItemText
                      primary={
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <Typography variant="body2" fontWeight={n.read ? 400 : 600} noWrap>
                            {n.title}
                          </Typography>
                          <Chip
                            size="small"
                            color={severityColor(n.severity)}
                            label={t(`notifications.severity.${n.severity}`, {
                              defaultValue: n.severity,
                            })}
                            sx={{ height: 20, flexShrink: 0 }}
                          />
                          <Chip
                            size="small"
                            variant="outlined"
                            label={t(`notifications.eventTypes.${n.eventType}`, {
                              defaultValue: n.eventType.replace(/_/g, ' '),
                            })}
                            sx={{ height: 20, flexShrink: 0 }}
                          />
                        </Stack>
                      }
                      secondary={
                        <>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            component="span"
                            noWrap
                          >
                            {n.body}
                          </Typography>
                          {' · '}
                          <Typography variant="caption" color="text.disabled" component="span">
                            {relativeTime(n.createdAt, t)}
                          </Typography>
                        </>
                      }
                    />
                  </ListItemButton>
                ))}
              </List>
            )}
            {page.hasNextPage && (
              <>
                <Divider />
                <Box sx={{ p: 1, textAlign: 'center' }}>
                  <Button
                    size="small"
                    onClick={page.fetchNextPage}
                    disabled={page.isFetchingNextPage}
                  >
                    {page.isFetchingNextPage
                      ? t('common.loading', { defaultValue: 'Loading…' })
                      : t('common.loadMore', { defaultValue: 'Load more' })}
                  </Button>
                </Box>
              </>
            )}
          </Card>
        </Stack>
      )}

      {/* Detail drawer with delivery timeline */}
      <Drawer
        anchor="right"
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        sx={{ '& .MuiDrawer-paper': { width: { xs: '100%', sm: 420 }, p: 2 } }}
      >
        <Box sx={{ p: 2 }}>
          {detail.isLoading || !detail.data ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress size={28} />
            </Box>
          ) : (
            <NotificationDetailContent
              notification={detail.data as Notification}
              deliveries={detail.data.deliveries ?? []}
            />
          )}
        </Box>
      </Drawer>
    </Box>
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
    <Stack spacing={2}>
      <Typography variant="h6">{notification.title}</Typography>
      <Typography variant="body2" color="text.secondary">
        {notification.body}
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap">
        <Chip
          size="small"
          color={severityColor(notification.severity)}
          label={notification.severity}
        />
        <Chip size="small" variant="outlined" label={notification.eventType.replace(/_/g, ' ')} />
        <Chip
          size="small"
          variant="outlined"
          label={
            notification.read ? t('notifications.status.READ') : t('notifications.status.UNREAD')
          }
        />
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {new Date(notification.createdAt).toLocaleString()}
        {notification.vehicleId ? ` · ${notification.vehicleId}` : ''}
      </Typography>

      <Divider />
      <Typography variant="subtitle2">
        {t('notifications.center.deliveries', { defaultValue: 'Delivery attempts' })}
      </Typography>
      {deliveries.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('notifications.center.noDeliveries', {
            defaultValue: 'No delivery attempts recorded',
          })}
        </Typography>
      ) : (
        <List dense>
          {deliveries.map((d) => (
            <ListItem key={d.id} sx={{ px: 0 }}>
              <ListItemText
                primary={
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Chip
                      size="small"
                      label={t(`notifications.channel.${d.channel}`, { defaultValue: d.channel })}
                      variant="outlined"
                    />
                    <Chip
                      size="small"
                      color={
                        d.status === 'SENT' || d.status === 'DELIVERED' || d.status === 'READ'
                          ? 'success'
                          : d.status === 'FAILED'
                            ? 'error'
                            : 'default'
                      }
                      label={t(`notifications.status.${d.status}`, { defaultValue: d.status })}
                    />
                    {d.attempts > 1 && (
                      <Typography variant="caption" color="text.secondary">
                        {t('notifications.center.attempts', {
                          defaultValue: '{{count}} attempts',
                          count: d.attempts,
                        })}
                      </Typography>
                    )}
                  </Stack>
                }
                secondary={
                  d.error ? (
                    <Typography variant="caption" color="error.main" component="span">
                      {d.error}
                    </Typography>
                  ) : d.provider ? (
                    <Typography variant="caption" color="text.secondary" component="span">
                      {d.provider}
                      {d.providerMessageId ? ` · ${d.providerMessageId}` : ''}
                    </Typography>
                  ) : undefined
                }
              />
            </ListItem>
          ))}
        </List>
      )}
    </Stack>
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
    <Card sx={{ p: 2 }}>
      <Stack spacing={3}>
        <Typography variant="body2" color="text.secondary">
          {t('notifications.preferences.hint', {
            defaultValue:
              'Choose how you are notified. Email requires a configured provider; SMS and push are unavailable until providers are configured.',
          })}
        </Typography>
        {categories.map((category) => {
          const pref = prefFor(category);
          return (
            <Box key={category}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="subtitle2" sx={{ textTransform: 'capitalize' }}>
                  {t(`notifications.category.${category}`, { defaultValue: category })}
                </Typography>
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={pref.enabled}
                      onChange={(e) =>
                        updatePreference.mutate({ category, enabled: e.target.checked })
                      }
                    />
                  }
                  label={t('notifications.preferences.enabled', { defaultValue: 'Enabled' })}
                />
              </Stack>
              <Stack direction="row" spacing={2} flexWrap="wrap" sx={{ mt: 1 }}>
                {PREFERENCE_CHANNELS.map((channel) => {
                  const health = healthByChannel.get(channel);
                  const available = health !== 'DISABLED';
                  const checked = pref.channels.includes(channel);
                  return available ? (
                    <FormControlLabel
                      key={channel}
                      control={
                        <Switch
                          size="small"
                          checked={checked}
                          onChange={(e) => toggleChannel(category, channel, e.target.checked)}
                          disabled={updatePreference.isPending}
                        />
                      }
                      label={t(`notifications.channel.${channel}`, { defaultValue: channel })}
                    />
                  ) : (
                    <Tooltip
                      key={channel}
                      title={t('notifications.preferences.channelUnavailable', {
                        defaultValue: 'Not configured — unavailable',
                      })}
                    >
                      <span>
                        <FormControlLabel
                          control={<Switch size="small" checked={false} disabled />}
                          label={t(`notifications.channel.${channel}`, { defaultValue: channel })}
                        />
                      </span>
                    </Tooltip>
                  );
                })}
              </Stack>
            </Box>
          );
        })}
      </Stack>
    </Card>
  );
}
