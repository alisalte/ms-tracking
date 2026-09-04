/**
 * Alarm Center API + data hooks.
 *
 * **Real backend**: notification-service —
 *   GET    /notification/alerts          — list alarms (cursor-paginated + filters)
 *   GET    /notification/alerts/:id      — alarm detail
 *   POST   /notification/alerts/:id/acknowledge
 *   POST   /notification/alerts/:id/resolve
 *
 * The notification-service runs on port 3010 (proxied via the same /api/v1 base).
 * In mock mode, falls back to static demo data on network error.
 *
 * The action mutations are optimistic: they update the React Query cache
 * immediately (state transition) and roll back on failure.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { extractDeviceCode, mapAlarmType } from '@/lib/alarm-copy';
import { resolveMock, shouldUseMock, withMockFallback } from '@/lib/mock-gate';
import { mockAlarmDetail, mockAlarms } from '@/mock/alarm-data';
import type { Alarm, AlarmStatus } from '@/types/alarm.types';
import { apiGetRaw, apiPost } from './client';
import { queryKeys } from './query-keys';

// ── Wire types (snake_case → camelCase mapping) ─────────────────────────────

/** Backend alert severity (INFO/LOW/MEDIUM/HIGH/CRITICAL) → the UI 4-level matrix. */
function mapSeverity(raw: string | undefined): Alarm['severity'] {
  switch ((raw ?? 'INFO').toUpperCase()) {
    case 'CRITICAL':
      return 'critical';
    case 'HIGH':
    case 'MEDIUM':
      return 'major';
    case 'LOW':
      return 'minor';
    default:
      return 'info';
  }
}

function wireDetailObject(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string' && raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function formatWireDetail(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string') return raw;
  try {
    return JSON.stringify(raw);
  } catch {
    return '';
  }
}

function mapAlarm(raw: Record<string, unknown>): Alarm {
  const message = (raw.message as string) ?? '';
  const detail = formatWireDetail(raw.detail);
  const detailObj = wireDetailObject(raw.detail);
  const codeFromDetail =
    typeof detailObj?.alarmCode === 'string'
      ? detailObj.alarmCode
      : typeof raw.code === 'string'
        ? raw.code
        : undefined;
  return {
    id: raw.id as string,
    type: mapAlarmType(raw.type as string | undefined),
    severity: mapSeverity(raw.severity as string | undefined),
    status: mapStatus(raw.status as string),
    vehicleId: (raw.vehicle_id as string) ?? '',
    vehicleLabel: (raw.vehicle_label as string) ?? (raw.vehicle_id as string) ?? '',
    driver: (raw.driver as string) ?? undefined,
    lat: (raw.lat as number) ?? 0,
    lng: (raw.lng as number) ?? 0,
    address: (raw.address as string) ?? '',
    raisedAt: (raw.raised_at as string) ?? new Date().toISOString(),
    ackedAt: (raw.acknowledged_at as string) ?? undefined,
    resolvedAt: (raw.resolved_at as string) ?? undefined,
    escalationStep: (raw.escalation_step as number) ?? 0,
    message,
    detail,
    code: codeFromDetail ?? extractDeviceCode(message),
    rawType: typeof raw.type === 'string' ? raw.type : undefined,
    sourceEvents: (raw.source_events as Alarm['sourceEvents']) ?? [],
  };
}

/** Map the backend OPEN/ACKNOWLEDGED/RESOLVED to the frontend raised/acked/resolved. */
function mapStatus(status: string): AlarmStatus {
  if (status === 'ACKNOWLEDGED') return 'acked';
  if (status === 'RESOLVED') return 'resolved';
  return 'raised';
}

// ── Fetchers ─────────────────────────────────────────────────────────────────

/** Server-side alarm list filters (Sprint G Part 32 — bounded server pagination). */
export interface AlarmListParams {
  status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  severity?: string;
  vehicleId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

/** GET /notification/alerts — real backend; mock fallback in dev. */
export async function fetchAlarms(params: AlarmListParams = {}): Promise<Alarm[]> {
  if (shouldUseMock()) return resolveMock(mockAlarms);
  return withMockFallback(
    async () => {
      // notification-service lists respond RAW (Page-shaped) — apiGetRaw.
      const page = await apiGetRaw<{ data: Record<string, unknown>[] }>('/notification/alerts', {
        limit: params.limit ?? 100,
        ...(params.status ? { status: params.status } : {}),
        ...(params.severity ? { severity: params.severity } : {}),
        ...(params.vehicleId ? { vehicleId: params.vehicleId } : {}),
        ...(params.from ? { from: params.from } : {}),
        ...(params.to ? { to: params.to } : {}),
      });
      return page.data.map(mapAlarm);
    },
    () => resolveMock(mockAlarms),
  );
}

/** GET /notification/alerts/:id — real backend; mock fallback in dev. */
async function fetchAlarmDetail(id: string): Promise<Alarm | undefined> {
  if (shouldUseMock()) return resolveMock(mockAlarmDetail(id));
  return withMockFallback(
    async () => {
      const res = await apiGetRaw<{ data: Record<string, unknown> }>(`/notification/alerts/${id}`);
      return res.data ? mapAlarm(res.data as Record<string, unknown>) : undefined;
    },
    () => resolveMock(mockAlarmDetail(id)),
  );
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/** The full alert list (filtering server-side; optional params). */
export function useAlarms(params: AlarmListParams = {}) {
  return useQuery({
    queryKey: queryKeys.alarms.list(),
    queryFn: () => fetchAlarms(params),
  });
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
 * Real backend: POST /notification/alerts/:id/acknowledge or :id/resolve.
 * Mock fallback in dev. Optimistic cache update + rollback on error.
 */
export function useTransitionAlarm() {
  const qc = useQueryClient();
  return useMutation<
    Alarm,
    Error,
    { id: string; status: AlarmStatus },
    { prev: Alarm[] | undefined }
  >({
    mutationFn: async ({ id, status }) => {
      if (shouldUseMock()) {
        const base = mockAlarmDetail(id);
        if (!base) throw new Error(`alarm ${id} not found`);
        return resolveMock({ ...base, status } satisfies Alarm);
      }
      const endpoint =
        status === 'resolved'
          ? `/notification/alerts/${id}/resolve`
          : `/notification/alerts/${id}/acknowledge`;
      const res = await apiPost<unknown, { data: Record<string, unknown> }>(endpoint, {});
      return mapAlarm(res.data);
    },
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
