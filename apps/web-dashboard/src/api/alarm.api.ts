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
import { displayLabel } from '@/lib/ids';
import { resolveMock, shouldUseMock, withMockFallback } from '@/lib/mock-gate';
import { formatVehicleLabel } from '@/lib/vehicle-label';
import { wireIso, wireNum, wireStr, wireValue } from '@/lib/wire-value';
import { mockAlarmDetail, mockAlarms } from '@/mock/alarm-data';
import type { Alarm, AlarmSourceEvent, AlarmStatus } from '@/types/alarm.types';
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

function mapSourceEvents(raw: unknown): AlarmSourceEvent[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { id: `event-${index}`, type: 'event', ts: '', detail: String(item ?? '') };
    }
    const e = item as Record<string, unknown>;
    const type = wireStr(e, 'type', 'eventType', 'event_type', 'kind') || 'event';
    const ts = wireIso(e, 'ts', 'occurredAt', 'occurred_at', 'capturedAt', 'detectedAt') ?? '';
    const explicitDetail = e.detail;
    let detail = '';
    if (typeof explicitDetail === 'string') detail = explicitDetail;
    else if (explicitDetail && typeof explicitDetail === 'object') {
      detail = formatWireDetail(explicitDetail);
    } else {
      const bits: string[] = [];
      for (const [k, v] of Object.entries(e)) {
        if (
          v == null ||
          typeof v === 'object' ||
          k === 'id' ||
          k === 'type' ||
          k === 'eventType' ||
          k === 'event_type' ||
          k === 'kind' ||
          k === 'ts' ||
          k === 'sourceEventId' ||
          k === 'capturedAt' ||
          k === 'occurredAt' ||
          k === 'occurred_at' ||
          k === 'detectedAt' ||
          k === 'lastSeenAt'
        ) {
          continue;
        }
        bits.push(`${k}: ${String(v)}`);
      }
      detail = bits.join(' · ');
    }
    return { id: wireStr(e, 'id', 'sourceEventId') || `${type}-${index}`, type, ts, detail };
  });
}

/** Nest serializes AlarmOccurrence as camelCase; older fixtures use snake_case. */
export function mapAlarm(raw: Record<string, unknown>): Alarm {
  const message = wireStr(raw, 'message');
  const detail = formatWireDetail(wireValue(raw, 'detail'));
  const detailObj = wireDetailObject(wireValue(raw, 'detail'));
  const codeFromDetail =
    typeof detailObj?.alarmCode === 'string'
      ? detailObj.alarmCode
      : wireStr(raw, 'code') || undefined;
  const vehicleId = wireStr(raw, 'vehicleId', 'vehicle_id');
  const vehicleLabel =
    wireStr(raw, 'vehicleLabel', 'vehicle_label') || displayLabel(vehicleId) || vehicleId;
  const lat = wireNum(raw, 'lat', 'latitude');
  const lng = wireNum(raw, 'lng', 'longitude');
  const address = wireStr(raw, 'address');
  return {
    id: wireStr(raw, 'id'),
    type: mapAlarmType(wireStr(raw, 'type') || undefined),
    severity: mapSeverity(wireStr(raw, 'severity') || undefined),
    status: mapStatus(wireStr(raw, 'status')),
    vehicleId,
    vehicleLabel,
    driver: wireStr(raw, 'driver') || undefined,
    lat,
    lng,
    address: address || (lat !== 0 || lng !== 0 ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : ''),
    raisedAt: wireIso(raw, 'raisedAt', 'raised_at') ?? '',
    ackedAt: wireIso(raw, 'acknowledgedAt', 'acknowledged_at', 'ackedAt'),
    resolvedAt: wireIso(raw, 'resolvedAt', 'resolved_at'),
    escalationStep: wireNum(raw, 'escalationStep', 'escalation_step'),
    message,
    detail,
    code: codeFromDetail || extractDeviceCode(message),
    rawType: wireStr(raw, 'type') || undefined,
    sourceEvents: mapSourceEvents(wireValue(raw, 'sourceEvents', 'source_events')),
    linkedClipId: wireStr(raw, 'linkedClipId', 'linked_clip_id') || undefined,
    linkedTripId: wireStr(raw, 'linkedTripId', 'linked_trip_id') || undefined,
  };
}

/** Map the backend OPEN/ACKNOWLEDGED/RESOLVED to the frontend raised/acked/resolved. */
function mapStatus(status: string): AlarmStatus {
  const s = status.toUpperCase();
  if (s === 'ACKNOWLEDGED' || s === 'ACKED') return 'acked';
  if (s === 'RESOLVED') return 'resolved';
  if (s === 'ESCALATED') return 'escalated';
  return 'raised';
}

async function applyVehicleCaptions(alarms: Alarm[]): Promise<Alarm[]> {
  if (alarms.length === 0) return alarms;
  try {
    const { fetchAllVehiclesAsMap } = await import('./asset.api');
    const { vehicles } = await fetchAllVehiclesAsMap();
    const labels = new Map(vehicles.map((v) => [v.id, formatVehicleLabel(v)] as const));
    return alarms.map((a) => {
      const label = labels.get(a.vehicleId);
      return label && label !== a.vehicleLabel ? { ...a, vehicleLabel: label } : a;
    });
  } catch {
    return alarms;
  }
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
      return applyVehicleCaptions(page.data.map(mapAlarm));
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
      if (!res.data) return undefined;
      const [alarm] = await applyVehicleCaptions([mapAlarm(res.data)]);
      return alarm;
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
  const qc = useQueryClient();
  return useQuery({
    queryKey: id ? queryKeys.alarms.detail(id) : ['alarms', 'detail', 'none'],
    queryFn: () => fetchAlarmDetail(id as string),
    enabled: Boolean(id),
    placeholderData: () =>
      qc.getQueryData<Alarm[]>(queryKeys.alarms.list())?.find((a) => a.id === id),
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
    { prev: Alarm[] | undefined; prevDetail: Alarm | undefined }
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
      // Backend returns `{ data: { id, status } }` — apiPost already unwraps
      // `.data`, so never remap that stub as a full alarm (it wipes vehicle,
      // time, and source events, and used to throw on `mapAlarm(undefined)`).
      await apiPost<unknown, Record<string, unknown>>(endpoint, {});
      const now = new Date().toISOString();
      const cached =
        qc.getQueryData<Alarm>(queryKeys.alarms.detail(id)) ??
        qc.getQueryData<Alarm[]>(queryKeys.alarms.list())?.find((a) => a.id === id);
      if (!cached) {
        const fresh = await fetchAlarmDetail(id);
        if (fresh) return { ...fresh, status };
        throw new Error(`alarm ${id} not found`);
      }
      return {
        ...cached,
        status,
        ackedAt:
          status === 'acked' || status === 'resolved' ? (cached.ackedAt ?? now) : cached.ackedAt,
        resolvedAt: status === 'resolved' ? now : cached.resolvedAt,
      };
    },
    onMutate: async ({ id, status }) => {
      const listKey = queryKeys.alarms.list();
      await qc.cancelQueries({ queryKey: listKey });
      await qc.cancelQueries({ queryKey: queryKeys.alarms.detail(id) });
      const prev = qc.getQueryData<Alarm[]>(listKey);
      const prevDetail = qc.getQueryData<Alarm>(queryKeys.alarms.detail(id));
      const now = new Date().toISOString();
      const patch = (a: Alarm): Alarm => ({
        ...a,
        status,
        ackedAt: status === 'acked' || status === 'resolved' ? (a.ackedAt ?? now) : a.ackedAt,
        resolvedAt: status === 'resolved' ? now : a.resolvedAt,
      });
      qc.setQueryData<Alarm[]>(listKey, (old) =>
        (old ?? []).map((a) => (a.id === id ? patch(a) : a)),
      );
      qc.setQueryData<Alarm | undefined>(queryKeys.alarms.detail(id), (old) =>
        old ? patch(old) : old,
      );
      return { prev, prevDetail };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.alarms.list(), ctx.prev);
      if (ctx) qc.setQueryData(queryKeys.alarms.detail(vars.id), ctx.prevDetail);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.alarms.all });
    },
  });
}
