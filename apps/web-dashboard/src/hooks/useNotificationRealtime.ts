/**
 * useNotificationRealtime — live notification push for the bell (Sprint H §39).
 *
 * Subscribes to the notification-service WS gateway:
 *   - `user:<tenantId>:<userId>`            — targeted per-user notifications
 *   - `tenant:<tenantId>:notifications`     — legacy broadcast notifications
 *
 * On `notification.new` the hook updates the React Query cache
 * INCREMENTALLY (prepend to the list + bump the unread count — Sprint H
 * §54: no full reload after every notification). Falls back gracefully to
 * the 30s unread-count polling in notification.api.ts when WS is offline.
 */
import { useEffect, useRef } from 'react';

import { queryKeys } from '@/api/query-keys';
import { useAuthStore } from '@/auth/auth.store';
import { useRealtimeSocket } from '@/hooks/useRealtimeSocket';
import { shouldUseMock } from '@/lib/mock-gate';
import { resolveRealtimeTarget } from '@/lib/realtime-url';
import type { Notification, UnreadCount } from '@/types/notification.types';
import { useQueryClient } from '@tanstack/react-query';

function mapWsNotification(raw: Record<string, unknown>): Notification {
  return {
    id: String(raw.id ?? ''),
    title: (raw.title as string) ?? '',
    body: (raw.body as string) ?? '',
    severity: ((raw.severity as string) ?? 'normal') as Notification['severity'],
    priority: ((raw.priority as string) ?? 'normal') as Notification['priority'],
    category: ((raw.category as string) ?? 'system') as Notification['category'],
    eventType: (raw.eventType as string) ?? 'system',
    vehicleId: (raw.vehicleId as string) ?? undefined,
    read: false,
    createdAt: (raw.createdAt as string) ?? new Date().toISOString(),
    link: (raw.link as string) ?? undefined,
  };
}

/**
 * Apply an incoming `notification.new` payload to the React Query caches —
 * INCREMENTALLY (prepend + unread-count bump; Sprint H §54: no full reload).
 * Exported pure so tests can drive it without a live WebSocket.
 */
export function applyIncomingNotification(
  qc: Pick<ReturnType<typeof useQueryClient>, 'setQueryData' | 'setQueriesData' | 'getQueryData'>,
  raw: Record<string, unknown>,
): void {
  if (!raw?.id) return;
  const notification = mapWsNotification(raw);

  // Prepend to every cached list (bounded — keeps the dropdown snappy).
  qc.setQueriesData<Notification[]>({ queryKey: queryKeys.notifications.list() }, (old) => {
    if (!old) return old;
    if (old.some((n) => n.id === notification.id)) return old;
    return [notification, ...old].slice(0, 100);
  });

  // Bump the unread count without a refetch.
  const countKey = queryKeys.notifications.unreadCount();
  const current = qc.getQueryData<UnreadCount>(countKey);
  if (current) {
    qc.setQueryData<UnreadCount>(countKey, {
      total: current.total + 1,
      critical: current.critical + (notification.severity === 'critical' ? 1 : 0),
      high: current.high + (notification.severity === 'high' ? 1 : 0),
    });
  }
}

export function useNotificationRealtime(wsUrl?: string) {
  const tenantId = useAuthStore((s) => s.tenantId);
  const userId = useAuthStore((s) => s.user?.id) ?? null;
  const qc = useQueryClient();

  const target = resolveRealtimeTarget(
    wsUrl ?? import.meta.env.VITE_NOTIFICATION_WS_URL,
    'http://localhost:3010',
    '/notif-ws/socket.io',
  );
  const enabled = Boolean(tenantId) && !shouldUseMock();

  const { state, subscribe, emit } = useRealtimeSocket({
    url: target.url,
    path: target.path,
    enabled,
  });
  const tenantRef = useRef(tenantId);
  const userRef = useRef(userId);
  tenantRef.current = tenantId;
  userRef.current = userId;

  // Join the per-user room (targeted notifications) + the tenant broadcast
  // room (legacy/Sprint 5 broadcast rows) on connect.
  useEffect(() => {
    if (state === 'connected' && tenantRef.current) {
      emit('subscribe', `tenant:${tenantRef.current}:notifications`);
      if (userRef.current) {
        emit('subscribe', `user:${tenantRef.current}:${userRef.current}`);
      }
    }
  }, [state, emit]);

  // Incremental cache updates on notification.new.
  useEffect(() => {
    if (!enabled) return;
    const unsub = subscribe('notification.new', (raw) => {
      applyIncomingNotification(qc, raw as Record<string, unknown>);
    });
    return unsub;
  }, [enabled, subscribe, qc]);
}
