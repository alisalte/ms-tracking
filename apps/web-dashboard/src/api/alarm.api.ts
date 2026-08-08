/**
 * Alarm Center API + data hooks.
 *
 * The Alarm Center (`12_Alarm_Engine.md` §5/§6, UI_UX alerts) needs the alert
 * list, alert detail, and the three operator actions (ack / resolve / contest,
 * §5.3). None of these endpoints exist in the backend yet — so each query
 * resolves from static mock data (`mock/alarm-data.ts`) with a small latency
 * to mimic a real fetch and exercise the loading skeleton states.
 *
 * The action mutations are optimistic: they update the React Query cache
 * immediately (state transition) and roll back on failure. When the
 * `notification-service` alarm endpoints land, swap the mock body for
 * `apiPost` and the hooks stay unchanged.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { mockAlarmDetail, mockAlarms } from '@/mock/alarm-data';
import type { Alarm, AlarmStatus } from '@/types/alarm.types';
import { queryKeys } from './query-keys';
import { resolveMock } from '@/lib/mock-gate';


// ── Fetchers (swap mock → apiGet when backends land) ─────────────────────────

/** GET /api/v1/notifications/alerts (pending backend). */
function fetchAlarms(): Promise<Alarm[]> {
  return resolveMock(mockAlarms);
}

/** GET /api/v1/notifications/alerts/{id} (pending backend). */
function fetchAlarmDetail(id: string): Promise<Alarm | undefined> {
  return resolveMock(mockAlarmDetail(id));
}

/** POST /api/v1/notifications/alerts/{id}:ack|:resolve|:contest (§5.3). */
function transitionAlarm(id: string, status: AlarmStatus): Promise<Alarm> {
  const base = mockAlarmDetail(id);
  if (!base) throw new Error(`alarm ${id} not found`);
  return resolveMock({ ...base, status } satisfies Alarm);
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/** The full alert list (filtering is client-side in the UI). */
export function useAlarms() {
  return useQuery({ queryKey: queryKeys.alarms.list(), queryFn: fetchAlarms });
}

/** Enriched detail for one alarm (the drawer). */
export function useAlarmDetail(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.alarms.detail(id) : ['alarms', 'detail', 'none'],
    queryFn: () => fetchAlarmDetail(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Optimistic state transition for an alarm (ack / resolve).
 *
 * Updates the list + detail cache in place; rolls back on failure. The contest
 * action is modeled as a transition to `resolved` with a false-positive flag
 * (the mock doesn't persist the flag separately).
 */
export function useTransitionAlarm() {
  const qc = useQueryClient();
  return useMutation<
    Alarm,
    Error,
    { id: string; status: AlarmStatus },
    { prev: Alarm[] | undefined }
  >({
    mutationFn: ({ id, status }) => transitionAlarm(id, status),
    onMutate: async ({ id, status }) => {
      const listKey = queryKeys.alarms.list();
      await qc.cancelQueries({ queryKey: listKey });
      const prev = qc.getQueryData<Alarm[]>(listKey);
      qc.setQueryData<Alarm[]>(listKey, (old) =>
        (old ?? []).map((a) =>
          a.id === id
            ? {
                ...a,
                status,
                ackedAt:
                  status === 'acked' || status === 'resolved'
                    ? (a.ackedAt ?? new Date().toISOString())
                    : a.ackedAt,
                resolvedAt: status === 'resolved' ? new Date().toISOString() : a.resolvedAt,
              }
            : a,
        ),
      );
      qc.setQueryData<Alarm | undefined>(queryKeys.alarms.detail(id), (old) =>
        old ? { ...old, status } : old,
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.alarms.list(), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.alarms.all });
    },
  });
}
