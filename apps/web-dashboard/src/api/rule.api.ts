/**
 * Alarm-rule API — REAL notification-service (`/api/v1/notification/rules`).
 *
 *   GET    /notification/rules
 *   POST   /notification/rules            snake_case create DTO
 *   PUT    /notification/rules/:id
 *   POST   /notification/rules/:id/enable    204
 *   POST   /notification/rules/:id/disable   204
 *   DELETE /notification/rules/:id           204
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { resolveMock, shouldUseMock, withMockFallback } from '@/lib/mock-gate';
import type { Page } from '@/types/api.types';
import type {
  AlarmRule,
  AlarmRuleSeverity,
  AlarmRuleType,
  CreateAlarmRulePayload,
  RepeatPolicy,
  UpdateAlarmRulePayload,
} from '@/types/rule.types';
import { apiDeleteNoContent, apiGet, apiGetRaw, apiPost, apiPostNoContent, apiPut } from './client';
import { queryKeys } from './query-keys';

const PAGE_SIZE = 200;
const MAX_PAGES = 50;

function asStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function asType(v: unknown): AlarmRuleType {
  return String(v ?? 'overspeed') as AlarmRuleType;
}

export function mapAlarmRule(raw: Record<string, unknown>): AlarmRule {
  const conditions = raw.conditions;
  return {
    id: String(raw.id ?? ''),
    tenantId: String(raw.tenantId ?? raw.tenant_id ?? ''),
    name: String(raw.name ?? ''),
    type: asType(raw.type),
    severity: String(raw.severity ?? 'MEDIUM').toUpperCase() as AlarmRuleSeverity,
    enabled: Boolean(raw.enabled),
    entityType: String(raw.entityType ?? raw.entity_type ?? 'vehicle'),
    entityId: asStr(raw.entityId ?? raw.entity_id),
    conditions:
      conditions && typeof conditions === 'object' && !Array.isArray(conditions)
        ? (conditions as Record<string, unknown>)
        : {},
    cooldownSec: Number(raw.cooldownSec ?? raw.cooldown_sec ?? 300),
    dedupWindowSec: Number(raw.dedupWindowSec ?? raw.dedup_window_sec ?? 600),
    repeatPolicy: String(raw.repeatPolicy ?? raw.repeat_policy ?? 'COOLDOWN') as RepeatPolicy,
    version: Number(raw.version ?? 1),
  };
}

function toCreateWire(payload: CreateAlarmRulePayload): Record<string, unknown> {
  return {
    name: payload.name,
    type: payload.type,
    severity: payload.severity,
    entity_id: payload.entityId ?? null,
    conditions: payload.conditions,
    cooldown_sec: payload.cooldownSec,
    dedup_window_sec: payload.dedupWindowSec,
    repeat_policy: payload.repeatPolicy,
  };
}

function toUpdateWire(payload: UpdateAlarmRulePayload): Record<string, unknown> {
  return {
    ...(payload.name !== undefined ? { name: payload.name } : {}),
    ...(payload.severity !== undefined ? { severity: payload.severity } : {}),
    ...(payload.conditions !== undefined ? { conditions: payload.conditions } : {}),
    ...(payload.cooldownSec !== undefined ? { cooldown_sec: payload.cooldownSec } : {}),
    ...(payload.dedupWindowSec !== undefined ? { dedup_window_sec: payload.dedupWindowSec } : {}),
    ...(payload.repeatPolicy !== undefined ? { repeat_policy: payload.repeatPolicy } : {}),
  };
}

const MOCK_RULES: AlarmRule[] = [
  {
    id: 'rule-1',
    tenantId: 'tenant-1',
    name: 'City overspeed 80',
    type: 'overspeed',
    severity: 'HIGH',
    enabled: true,
    entityType: 'vehicle',
    entityId: null,
    conditions: { thresholdKmh: 80, gracePeriodSec: 5 },
    cooldownSec: 300,
    dedupWindowSec: 600,
    repeatPolicy: 'COOLDOWN',
    version: 1,
  },
];

async function fetchAllRules(): Promise<AlarmRule[]> {
  const out: AlarmRule[] = [];
  let cursor: string | null | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await apiGetRaw<Page<Record<string, unknown>>>('/notification/rules', {
      limit: PAGE_SIZE,
      cursor,
    });
    out.push(...result.data.map(mapAlarmRule));
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return out;
}

function fetchRules(): Promise<AlarmRule[]> {
  if (shouldUseMock()) return resolveMock(MOCK_RULES);
  return withMockFallback(
    () => fetchAllRules(),
    () => resolveMock(MOCK_RULES),
  );
}

export function useAlarmRules() {
  return useQuery({
    queryKey: queryKeys.alarms.rules(),
    queryFn: fetchRules,
  });
}

export function useAlarmRuleDetail(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.alarms.ruleDetail(id) : ['alarms', 'rule', 'none'],
    queryFn: async () =>
      mapAlarmRule((await apiGet<Record<string, unknown>>(`/notification/rules/${id}`)) ?? {}),
    enabled: Boolean(id),
  });
}

export function useCreateAlarmRule() {
  const qc = useQueryClient();
  return useMutation<{ id: string }, Error, CreateAlarmRulePayload>({
    mutationFn: (payload) =>
      apiPost<Record<string, unknown>, { id: string }>('/notification/rules', toCreateWire(payload)),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.alarms.rules() }),
  });
}

export function useUpdateAlarmRule() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; changes: UpdateAlarmRulePayload }>({
    mutationFn: async ({ id, changes }) => {
      await apiPut<Record<string, unknown>, { id: string }>(
        `/notification/rules/${id}`,
        toUpdateWire(changes),
      );
    },
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.alarms.ruleDetail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.alarms.rules() });
    },
  });
}

export function useEnableAlarmRule() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiPostNoContent(`/notification/rules/${id}/enable`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.alarms.rules() }),
  });
}

export function useDisableAlarmRule() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiPostNoContent(`/notification/rules/${id}/disable`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.alarms.rules() }),
  });
}

export function useDeleteAlarmRule() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteNoContent(`/notification/rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.alarms.rules() }),
  });
}
