/**
 * Notification API + hooks — the notification center data layer (Sprint H).
 *
 * Real backend: notification-service —
 *   GET  /notification/notifications          — list (cursor-paginated, filters)
 *   GET  /notification/notifications/:id      — detail + delivery attempts
 *   GET  /notification/notifications/unread-count
 *   GET  /notification/notifications/channels — provider health
 *   POST /notification/notifications/:id/read
 *   POST /notification/notifications/read-all
 *   GET  /notification/notifications/preferences
 *   PUT  /notification/notifications/preferences
 *
 * In mock mode, returns empty (no mock notification data — the bell simply
 * shows zero unread when the backend isn't available).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { resolveMock, shouldUseMock, withMockFallback } from '@/lib/mock-gate';
import { useCursorPagination } from '@/lib/use-cursor-pagination';
import type {
  ChannelHealth,
  Notification,
  NotificationDetail,
  NotificationPreference,
  UnreadCount,
} from '@/types/notification.types';
// notification-service responds RAW (no { data } envelope) for lists and
// counts (Page-shaped bodies / plain objects) — apiGetRaw, like the
// fleet-management + map-engine modules (see asset.api.ts).
import { apiGetRaw, apiPostNoContent, apiPut } from './client';
import { queryKeys } from './query-keys';

export interface NotificationListParams {
  unreadOnly?: boolean;
  eventType?: string;
  severity?: string;
  vehicleId?: string;
  from?: string;
  to?: string;
  scope?: 'own' | 'all';
  limit?: number;
}

function mapNotification(raw: Record<string, unknown>): Notification {
  return {
    id: raw.id as string,
    title: (raw.title as string) ?? '',
    body: (raw.body as string) ?? '',
    severity: ((raw.severity as string) ?? 'normal') as Notification['severity'],
    priority: ((raw.priority as string) ?? 'normal') as Notification['priority'],
    category: ((raw.category as string) ?? 'system') as Notification['category'],
    eventType: (raw.eventType as string) ?? (raw.event_type as string) ?? 'system',
    vehicleId: (raw.vehicleId as string) ?? (raw.vehicle_id as string) ?? undefined,
    read: (raw.read as boolean) ?? false,
    createdAt: (raw.created_at as string) ?? new Date().toISOString(),
    link: (raw.link as string) ?? undefined,
  };
}

async function fetchNotifications(params: NotificationListParams = {}): Promise<Notification[]> {
  // Real mode: errors propagate (no fabricated "no notifications" success —
  // §22); mock mode falls back to an empty list when the service is down.
  return withMockFallback(
    async () => {
      const page = await apiGetRaw<{ data: Record<string, unknown>[] }>(
        '/notification/notifications',
        {
          limit: params.limit ?? 50,
          ...(params.unreadOnly ? { unreadOnly: 'true' } : {}),
          ...(params.eventType ? { eventType: params.eventType } : {}),
          ...(params.severity ? { severity: params.severity } : {}),
          ...(params.vehicleId ? { vehicleId: params.vehicleId } : {}),
          ...(params.from ? { from: params.from } : {}),
          ...(params.to ? { to: params.to } : {}),
          ...(params.scope ? { scope: params.scope } : {}),
        },
      );
      return page.data.map(mapNotification);
    },
    () => resolveMock([]),
  );
}

async function fetchNotificationDetail(id: string): Promise<NotificationDetail> {
  return withMockFallback(
    async () => {
      const res = await apiGetRaw<{ data: Record<string, unknown> }>(
        `/notification/notifications/${id}`,
      );
      const raw = res.data ?? {};
      return {
        ...mapNotification(raw),
        deliveries: ((raw.deliveries as Record<string, unknown>[]) ?? []).map((d) => ({
          id: d.id as string,
          channel: d.channel as NotificationDetail['deliveries'][number]['channel'],
          status: d.status as NotificationDetail['deliveries'][number]['status'],
          attempts: (d.attempts as number) ?? 0,
          error: (d.error as string) ?? null,
          provider: (d.provider as string) ?? null,
          providerMessageId: (d.provider_message_id as string) ?? null,
          sentAt: (d.sent_at as string) ?? null,
          nextAttemptAt: (d.next_attempt_at as string) ?? null,
          createdAt: (d.created_at as string) ?? new Date().toISOString(),
        })),
      };
    },
    () => resolveMock({ ...({} as Notification), deliveries: [] }),
  );
}

async function fetchUnreadCount(): Promise<UnreadCount> {
  return withMockFallback(
    () => apiGetRaw<UnreadCount>('/notification/notifications/unread-count'),
    () => resolveMock({ total: 0, critical: 0, high: 0 }),
  );
}

async function fetchPreferences(): Promise<NotificationPreference[]> {
  return withMockFallback(
    async () => {
      const res = await apiGetRaw<{ data: Record<string, unknown>[] }>(
        '/notification/notifications/preferences',
      );
      return res.data.map((p) => ({
        category: p.category as string,
        minSeverity: (p.minSeverity as NotificationPreference['minSeverity']) ?? 'normal',
        channels: (p.channels as NotificationPreference['channels']) ?? ['in_app'],
        enabled: (p.enabled as boolean) ?? true,
      }));
    },
    () => resolveMock([]),
  );
}

async function fetchChannelHealth(): Promise<ChannelHealth[]> {
  return withMockFallback(
    async () => {
      const res = await apiGetRaw<{ data: ChannelHealth[] }>(
        '/notification/notifications/channels',
      );
      return res.data;
    },
    () => resolveMock([]),
  );
}

/** Recent notifications for the bell popover. */
export function useNotifications(params: NotificationListParams = {}) {
  return useQuery({
    queryKey: [...queryKeys.notifications.list(), params],
    queryFn: () => fetchNotifications(params),
  });
}

/** Server-side paginated + filtered history for the Notification Center page. */
export function useNotificationsPage(params: NotificationListParams = {}) {
  return useCursorPagination(
    [...queryKeys.notifications.list(), 'page', params],
    async (cursor) => {
      const page = await withMockFallback(
        async () => {
          const res = await apiGetRaw<{
            data: Record<string, unknown>[];
            nextCursor: string | null;
          }>('/notification/notifications', {
            limit: params.limit ?? 25,
            ...(cursor ? { cursor } : {}),
            ...(params.unreadOnly ? { unreadOnly: 'true' } : {}),
            ...(params.eventType ? { eventType: params.eventType } : {}),
            ...(params.severity ? { severity: params.severity } : {}),
            ...(params.vehicleId ? { vehicleId: params.vehicleId } : {}),
            ...(params.from ? { from: params.from } : {}),
            ...(params.to ? { to: params.to } : {}),
            ...(params.scope ? { scope: params.scope } : {}),
          });
          return { data: res.data.map(mapNotification), nextCursor: res.nextCursor };
        },
        () => resolveMock({ data: [] as Notification[], nextCursor: null }),
      );
      return page;
    },
  );
}

/** Notification detail + delivery attempts timeline. */
export function useNotificationDetail(id: string | null) {
  return useQuery({
    queryKey: [...queryKeys.notifications.all, 'detail', id],
    queryFn: () => fetchNotificationDetail(id as string),
    enabled: Boolean(id),
  });
}

/** Unread count — polled every 30s as a WS fallback for the bell badge. */
export function useUnreadCount() {
  return useQuery({
    queryKey: queryKeys.notifications.unreadCount(),
    queryFn: fetchUnreadCount,
    refetchInterval: 30_000,
  });
}

/** Channel provider readiness (CONFIGURED/DISABLED — no secrets). */
export function useChannelHealth() {
  return useQuery({
    queryKey: [...queryKeys.notifications.all, 'channels'],
    queryFn: fetchChannelHealth,
  });
}

/** The user's notification preferences. */
export function useNotificationPreferences() {
  return useQuery({
    queryKey: queryKeys.notifications.preferences(),
    queryFn: fetchPreferences,
  });
}

/** Mark a single notification as read. */
export function useMarkAsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!shouldUseMock()) {
        await apiPostNoContent(`/notification/notifications/${id}/read`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.notifications.all });
    },
  });
}

/** Mark all notifications as read. */
export function useMarkAllAsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!shouldUseMock()) {
        await apiPostNoContent('/notification/notifications/read-all');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.notifications.all });
    },
  });
}

/** Update user notification preferences (own preferences only). */
export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      category: string;
      min_severity?: string;
      channels?: string[];
      enabled?: boolean;
    }) => {
      if (!shouldUseMock()) {
        return apiPut<typeof body, { data: Record<string, unknown> }>(
          '/notification/notifications/preferences',
          body,
        );
      }
      return { data: {} };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.notifications.preferences() });
    },
  });
}
