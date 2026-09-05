/**
 * useAlarmRealtime — subscribe to alarm/notification WebSocket events.
 *
 * The notification-service (alarm delivery tier) is not yet built. This hook is
 * designed to connect when the backend lands, and degrade gracefully (no-op)
 * when no WS server is available. In dev, the alarm list stays poll-based.
 *
 * Expected events (when the backend ships):
 * - `notification.alert.raised.v1` → new alarm (prepend to list)
 * - `notification.alert.escalated.v1` → alarm escalated (update status)
 * - `notification.alert.acknowledged.v1` → alarm acked (update status)
 * - `notification.alert.resolved.v1` → alarm resolved (update status)
 *
 * The hook returns the connection state so the Alarm Center can show a
 * "Live" or "Reconnecting…" badge.
 */
import { useEffect, useRef, useState } from 'react';

import { mapAlarm } from '@/api/alarm.api';
import { type ConnectionState, useRealtimeSocket } from '@/hooks/useRealtimeSocket';
import { shouldUseMock } from '@/lib/mock-gate';
import { resolveRealtimeTarget } from '@/lib/realtime-url';
import type { Alarm } from '@/types/alarm.types';

export interface AlarmRealtimeEvent {
  type: 'raised' | 'escalated' | 'acknowledged' | 'resolved';
  alarm: Alarm;
}

export interface AlarmRealtimeResult {
  /** Events received since last clear (for UI to process). */
  events: AlarmRealtimeEvent[];
  /** Clear the events buffer after processing. */
  clearEvents: () => void;
  /** WebSocket connection state. */
  connectionState: ConnectionState;
}

/**
 * Subscribe to alarm real-time events.
 *
 * @param tenantId The tenant scope.
 * @param wsUrl    The notification-service WS URL.
 */
export function useAlarmRealtime(tenantId: string | null, wsUrl?: string): AlarmRealtimeResult {
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
  const [events, setEvents] = useState<AlarmRealtimeEvent[]>([]);
  const tenantRef = useRef(tenantId);
  tenantRef.current = tenantId;

  // Join the tenant's alarm room on connect.
  useEffect(() => {
    if (state === 'connected' && tenantRef.current) {
      emit('subscribe', `tenant:${tenantRef.current}:alerts`);
    }
  }, [state, emit]);

  // Listen for all alarm event types.
  useEffect(() => {
    if (!enabled) return;

    const channels: Array<[string, AlarmRealtimeEvent['type']]> = [
      // Sprint 4 notification-service event names.
      ['alarm.created', 'raised'],
      ['alarm.acknowledged', 'acknowledged'],
      ['alarm.resolved', 'resolved'],
      // Legacy versioned names (backward compat).
      ['notification.alert.raised.v1', 'raised'],
      ['notification.alert.escalated.v1', 'escalated'],
      ['notification.alert.acknowledged.v1', 'acknowledged'],
      ['notification.alert.resolved.v1', 'resolved'],
    ];

    const unsubs = channels.map(([eventName, type]) =>
      subscribe(eventName, (raw) => {
        // The notification-service gateway (alarm-realtime.gateway.ts) emits a
        // FLAT payload: { id, type, severity, status, vehicleId, message, … } —
        // map it to the frontend Alarm shape (Sprint G fix; the old extraction
        // expected nested { alert | data } envelopes and silently dropped
        // every event).
        const flat = raw as Record<string, unknown>;
        const alarm = flat?.id ? mapAlarm(flat) : null;
        if (!alarm || !alarm.id) return;
        setEvents((prev) => [...prev, { type, alarm }]);
      }),
    );

    return () => {
      for (const u of unsubs) u();
    };
  }, [enabled, subscribe]);

  const clearEvents = () => setEvents([]);

  return { events, clearEvents, connectionState: state };
}
