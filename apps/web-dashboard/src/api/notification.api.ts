/**
 * Notification API + hooks — the notification center data layer.
 *
 * Real backend: notification-service —
 *   GET  /notification/notifications          — list (cursor-paginated + unreadOnly filter)
 *   GET  /notification/notifications/unread-count
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
import type { Notification, UnreadCount } from '@/types/notification.types';
import { apiGet, apiPostNoContent, apiPut } from './client';
import { queryKeys } from './query-keys';

function mapNotification(raw: Record<string, unknown>): Notification {
  return {
    id: raw.id as string,
    title: (raw.title as string) ?? '',
    body: (raw.body as string) ?? '',
    severity: ((raw.severity as string) ?? 'normal') as Notification['severity'],
    category: ((raw.category as string) ?? 'system') as Notification['category'],
    read: (raw.read as boolean) ?? false,
    createdAt: (raw.created_at as string) ?? new Date().toISOString(),
    link: (raw.link as string) ?? undefined,
  };
}

async function fetchNotifications(): Promise<Notification[]> {
  // Real mode: errors propagate (no fabricated "no notifications" success —
  // §22); mock mode falls back to an empty list when the service is down.
  return withMockFallback(
    async () => {
      const page = await apiGet<{ data: Record<string, unknown>[] }>(
        '/notification/notifications',
        {
          limit: 50,
        },
      );
      return page.data.map(mapNotification);
    },
    () => resolveMock([]),
  );
}

async function fetchUnreadCount(): Promise<UnreadCount> {
  return withMockFallback(
    () => apiGet<UnreadCount>('/notification/notifications/unread-count'),
    () => resolveMock({ total: 0, critical: 0, high: 0 }),
  );
}

/** Recent notifications for the bell popover. */
export function useNotifications() {
  return useQuery({ queryKey: queryKeys.notifications.list(), queryFn: fetchNotifications });
}

/** Unread count — polled every 30s for the bell badge. */
export function useUnreadCount() {
  return useQuery({
    queryKey: queryKeys.notifications.unreadCount(),
    queryFn: fetchUnreadCount,
    refetchInterval: 30_000,
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

/** Update user notification preferences. */
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
