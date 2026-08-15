import { useQueryClient } from '@tanstack/react-query';
/**
 * AlarmLiveIndicator — the honest connection-state badge for the Alarm Center.
 *
 * It wires the real `useAlarmRealtime` Socket.IO subscription to the
 * notification-service and reflects the actual connection state in the UI:
 *   - connected  → "Live" (green pulsing dot)
 *   - connecting → "Connecting…" (amber)
 *   - error/idle → "Polling" (gray) — the list falls back to REST polling.
 *
 * Live alarm events are merged into the React Query alarms cache so new/acked/
 * resolved alarms appear without a refetch. When no WS server is reachable
 * (e.g. local dev without the notification-service), the badge honestly shows
 * "Polling" instead of pretending the data is live.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { queryKeys } from '@/api/query-keys';
import { useAuthStore } from '@/auth/auth.store';
import { useAlarmRealtime } from '@/hooks/useAlarmRealtime';
import type { Alarm } from '@/types/alarm.types';

export function AlarmLiveIndicator() {
  const { t } = useTranslation();
  const tenantId = useAuthStore((s) => s.tenantId);
  const queryClient = useQueryClient();

  const { events, clearEvents, connectionState } = useAlarmRealtime(tenantId);

  // Fold realtime events into the cached alarm list so the UI reflects them.
  useEffect(() => {
    if (events.length === 0) return;
    queryClient.setQueryData<Alarm[]>(queryKeys.alarms.list(), (prev) => {
      if (!prev) return prev;
      const byId = new Map(prev.map((a) => [a.id, a] as const));
      for (const ev of events) {
        const existing = byId.get(ev.alarm.id);
        if (ev.type === 'raised' && !existing) {
          byId.set(ev.alarm.id, ev.alarm);
        } else if (existing) {
          // Apply the latest state from the event alarm payload.
          byId.set(ev.alarm.id, { ...existing, ...ev.alarm });
        }
      }
      return [...byId.values()];
    });
    clearEvents();
  }, [events, clearEvents, queryClient]);

  if (connectionState === 'connected') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="fv-live-dot" />
        <span className="text-xs font-semibold text-success-600 dark:text-success-400">
          {t('dashboard.live')}
        </span>
      </span>
    );
  }

  if (connectionState === 'connecting') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full bg-warning-500" />
        <span className="text-xs font-semibold text-warning-600 dark:text-warning-400">
          {t('alarms.connecting')}
        </span>
      </span>
    );
  }

  // error / idle / closed → the list is served by REST polling, not realtime.
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full bg-gray-400" />
      <span className="text-xs font-semibold text-gray-500 dark:text-graydark-500">
        {t('alarms.polling')}
      </span>
    </span>
  );
}
