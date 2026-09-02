/**
 * AlarmRulesPage — configure alarm laws (`/rules`).
 *
 * Wired to notification-service `/api/v1/notification/rules` (Sprint G).
 * Create / edit / enable / disable / delete. Condition fields follow the
 * per-type schemas the engine actually evaluates.
 */
import { Scale } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { getApiErrorMessage } from '@/api/errors';
import { useGeofences } from '@/api/geofence.api';
import {
  useAlarmRules,
  useCreateAlarmRule,
  useDeleteAlarmRule,
  useDisableAlarmRule,
  useEnableAlarmRule,
  useUpdateAlarmRule,
} from '@/api/rule.api';
import { useVehicles } from '@/api/asset.api';
import { PERMISSIONS, PermissionGate } from '@/auth/permissions';
import { ErrorState } from '@/components/common/ErrorState';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { useToast } from '@/components/feedback/ToastProvider';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Drawer,
  EmptyState,
  Input,
  PageHeader,
  Select,
  type TableColumn,
  Toolbar,
} from '@/components/tailwind-ui';
import type {
  AlarmRule,
  AlarmRuleSeverity,
  AlarmRuleType,
  RepeatPolicy,
} from '@/types/rule.types';
import {
  ALARM_RULE_SEVERITIES,
  ALARM_RULE_TYPES,
  REPEAT_POLICIES,
} from '@/types/rule.types';

interface RuleFormValues {
  name: string;
  type: AlarmRuleType;
  severity: AlarmRuleSeverity;
  entityId: string;
  cooldownSec: string;
  dedupWindowSec: string;
  repeatPolicy: RepeatPolicy;
  thresholdKmh: string;
  gracePeriodSec: string;
  minDurationSec: string;
  minOfflineSec: string;
  dwellSec: string;
  maxDurationSec: string;
  maxStopDurationSec: string;
  geofenceId: string;
}

const EMPTY: RuleFormValues = {
  name: '',
  type: 'overspeed',
  severity: 'MEDIUM',
  entityId: '',
  cooldownSec: '300',
  dedupWindowSec: '600',
  repeatPolicy: 'COOLDOWN',
  thresholdKmh: '80',
  gracePeriodSec: '0',
  minDurationSec: '600',
  minOfflineSec: '300',
  dwellSec: '600',
  maxDurationSec: '14400',
  maxStopDurationSec: '1800',
  geofenceId: '',
};

function num(raw: string): number | undefined {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function conditionsFromForm(v: RuleFormValues): Record<string, unknown> {
  switch (v.type) {
    case 'overspeed':
      return {
        thresholdKmh: num(v.thresholdKmh) ?? 80,
        ...(num(v.gracePeriodSec) ? { gracePeriodSec: num(v.gracePeriodSec) } : {}),
      };
    case 'prolonged_idle':
    case 'parking':
      return { minDurationSec: num(v.minDurationSec) ?? 600 };
    case 'device_offline':
      return { ...(num(v.minOfflineSec) ? { minOfflineSec: num(v.minOfflineSec) } : {}) };
    case 'geofence_enter':
    case 'geofence_exit':
      return { ...(v.geofenceId ? { geofenceId: v.geofenceId } : {}) };
    case 'geofence_dwell':
      return {
        ...(v.geofenceId ? { geofenceId: v.geofenceId } : {}),
        ...(num(v.dwellSec) ? { dwellSec: num(v.dwellSec) } : {}),
      };
    case 'excessive_trip_duration':
      return { maxDurationSec: num(v.maxDurationSec) ?? 14400 };
    case 'excessive_stop_duration':
      return { maxStopDurationSec: num(v.maxStopDurationSec) ?? 1800 };
    default:
      return {};
  }
}

function formFromRule(r: AlarmRule): RuleFormValues {
  const c = r.conditions;
  return {
    ...EMPTY,
    name: r.name,
    type: r.type,
    severity: r.severity,
    entityId: r.entityId ?? '',
    cooldownSec: String(r.cooldownSec),
    dedupWindowSec: String(r.dedupWindowSec),
    repeatPolicy: r.repeatPolicy,
    thresholdKmh: String(c.thresholdKmh ?? 80),
    gracePeriodSec: String(c.gracePeriodSec ?? 0),
    minDurationSec: String(c.minDurationSec ?? 600),
    minOfflineSec: String(c.minOfflineSec ?? 300),
    dwellSec: String(c.dwellSec ?? 600),
    maxDurationSec: String(c.maxDurationSec ?? 14400),
    maxStopDurationSec: String(c.maxStopDurationSec ?? 1800),
    geofenceId: String(c.geofenceId ?? ''),
  };
}

function summarizeConditions(r: AlarmRule, t: (k: string) => string): string {
  const c = r.conditions;
  if (r.type === 'overspeed') return `${c.thresholdKmh ?? '—'} km/h`;
  if (r.type === 'prolonged_idle' || r.type === 'parking') return `${c.minDurationSec ?? '—'} s`;
  if (r.type === 'device_offline') return `${c.minOfflineSec ?? '—'} s`;
  if (r.type === 'excessive_trip_duration') return `${c.maxDurationSec ?? '—'} s`;
  if (r.type === 'excessive_stop_duration') return `${c.maxStopDurationSec ?? '—'} s`;
  if (r.type.startsWith('geofence')) return r.entityId ? String(c.geofenceId ?? t('rules.allGeofences')) : t('rules.allGeofences');
  return t('rules.noParams');
}

function severityColor(s: AlarmRuleSeverity): 'gray' | 'info' | 'warning' | 'danger' | 'success' {
  if (s === 'CRITICAL' || s === 'HIGH') return 'danger';
  if (s === 'MEDIUM') return 'warning';
  if (s === 'LOW') return 'info';
  return 'gray';
}

export function AlarmRulesPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const rulesQuery = useAlarmRules();
  const vehiclesQuery = useVehicles();
  const geofencesQuery = useGeofences();
  const createRule = useCreateAlarmRule();
  const updateRule = useUpdateAlarmRule();
  const enableRule = useEnableAlarmRule();
  const disableRule = useDisableAlarmRule();
  const deleteRule = useDeleteAlarmRule();

  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AlarmRule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AlarmRule | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const { control, handleSubmit, reset, watch } = useForm<RuleFormValues>({ defaultValues: EMPTY });
  const type = watch('type');

  const rules = rulesQuery.data ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter(
      (r) => r.name.toLowerCase().includes(q) || r.type.toLowerCase().includes(q),
    );
  }, [rules, query]);

  const openCreate = () => {
    setEditTarget(null);
    reset(EMPTY);
    setServerError(null);
    setFormOpen(true);
  };
  const openEdit = (r: AlarmRule) => {
    setEditTarget(r);
    reset(formFromRule(r));
    setServerError(null);
    setFormOpen(true);
  };

  const onSubmit = async (values: RuleFormValues) => {
    setServerError(null);
    const payload = {
      name: values.name.trim(),
      type: values.type,
      severity: values.severity,
      entityId: values.entityId || null,
      conditions: conditionsFromForm(values),
      cooldownSec: num(values.cooldownSec) ?? 300,
      dedupWindowSec: num(values.dedupWindowSec) ?? 600,
      repeatPolicy: values.repeatPolicy,
    };
    try {
      if (editTarget) {
        await updateRule.mutateAsync({
          id: editTarget.id,
          changes: {
            name: payload.name,
            severity: payload.severity,
            conditions: payload.conditions,
            cooldownSec: payload.cooldownSec,
            dedupWindowSec: payload.dedupWindowSec,
            repeatPolicy: payload.repeatPolicy,
          },
        });
        toast.success(t('rules.updateSuccess'));
      } else {
        await createRule.mutateAsync(payload);
        toast.success(t('rules.createSuccess'));
      }
      setFormOpen(false);
    } catch (err) {
      const msg = getApiErrorMessage(err);
      setServerError(msg);
      toast.error(msg);
    }
  };

  const toggleEnabled = async (r: AlarmRule) => {
    try {
      if (r.enabled) await disableRule.mutateAsync(r.id);
      else await enableRule.mutateAsync(r.id);
    } catch (err) {
      toast.error(err);
    }
  };

  const onConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteRule.mutateAsync(deleteTarget.id);
      toast.success(t('rules.deleteSuccess'));
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err);
    }
  };

  const columns: Array<TableColumn<AlarmRule>> = [
    {
      id: 'name',
      headerKey: 'rules.colName',
      sortBy: (r) => r.name,
      render: (r) => <span className="font-medium text-gray-800 dark:text-graydark-800">{r.name}</span>,
    },
    {
      id: 'type',
      headerKey: 'rules.colType',
      render: (r) => t(`rules.types.${r.type}`),
    },
    {
      id: 'severity',
      headerKey: 'rules.colSeverity',
      render: (r) => (
        <Badge color={severityColor(r.severity)} dot>
          {t(`rules.severities.${r.severity}`)}
        </Badge>
      ),
    },
    {
      id: 'conditions',
      headerKey: 'rules.colConditions',
      render: (r) => (
        <span className="text-xs text-gray-600 dark:text-graydark-700">
          {summarizeConditions(r, t)}
        </span>
      ),
    },
    {
      id: 'enabled',
      headerKey: 'rules.colEnabled',
      render: (r) => (
        <Badge color={r.enabled ? 'success' : 'gray'} dot>
          {r.enabled ? t('rules.enabled') : t('rules.disabled')}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: t('common.actions'),
      align: 'end',
      render: (r) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <PermissionGate requires={PERMISSIONS.ruleWrite}>
            <Button size="sm" variant="outline" onClick={() => void toggleEnabled(r)}>
              {r.enabled ? t('rules.disable') : t('rules.enable')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
              {t('common.edit')}
            </Button>
            <Button size="sm" variant="danger" onClick={() => setDeleteTarget(r)}>
              {t('common.delete')}
            </Button>
          </PermissionGate>
        </div>
      ),
    },
  ];

  const pending = createRule.isPending || updateRule.isPending;
  const needsThreshold = type === 'overspeed';
  const needsDuration = type === 'prolonged_idle' || type === 'parking';
  const needsOffline = type === 'device_offline';
  const needsGeofence = type === 'geofence_enter' || type === 'geofence_exit' || type === 'geofence_dwell';
  const needsTripMax = type === 'excessive_trip_duration';
  const needsStopMax = type === 'excessive_stop_duration';

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title={t('rules.title')}
        description={t('rules.subtitle')}
        actions={
          <PermissionGate requires={PERMISSIONS.ruleCreate}>
            <Button size="sm" onClick={openCreate}>
              {t('rules.add')}
            </Button>
          </PermissionGate>
        }
      />

      {rulesQuery.isError ? (
        <ErrorState error={rulesQuery.error} onRetry={() => void rulesQuery.refetch()} />
      ) : (
        <>
          <Toolbar
            search
            searchValue={query}
            onSearchChange={setQuery}
            searchPlaceholder={t('rules.search')}
            right={
              <span className="text-xs text-gray-500 dark:text-graydark-600">
                {t('assets.count', { count: filtered.length })}
              </span>
            }
          />
          <DataTable
            rows={filtered}
            columns={columns}
            rowKey={(r) => r.id}
            loading={rulesQuery.isLoading}
            onRowClick={openEdit}
            maxHeight="calc(100vh - 280px)"
            emptyState={
              <EmptyState icon={<Scale />} title={t('rules.empty')} description={t('rules.emptyHelp')} />
            }
          />
        </>
      )}

      <Drawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editTarget ? t('rules.edit') : t('rules.add')}
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={pending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="rule-form" loading={pending}>
              {editTarget ? t('common.save') : t('common.create')}
            </Button>
          </>
        }
      >
        <form id="rule-form" onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {serverError && <Alert variant="danger">{serverError}</Alert>}
          <Controller
            control={control}
            name="name"
            rules={{ required: true }}
            render={({ field }) => (
              <Input {...field} label={`${t('rules.name')} *`} />
            )}
          />
          <Controller
            control={control}
            name="type"
            render={({ field }) => (
              <Select
                {...field}
                label={`${t('rules.type')} *`}
                disabled={Boolean(editTarget)}
                options={ALARM_RULE_TYPES.map((tp) => ({
                  value: tp,
                  label: t(`rules.types.${tp}`),
                }))}
              />
            )}
          />
          <Controller
            control={control}
            name="severity"
            render={({ field }) => (
              <Select
                {...field}
                label={t('rules.severity')}
                options={ALARM_RULE_SEVERITIES.map((s) => ({
                  value: s,
                  label: t(`rules.severities.${s}`),
                }))}
              />
            )}
          />
          <Controller
            control={control}
            name="entityId"
            render={({ field }) => (
              <Select
                {...field}
                label={t('rules.entity')}
                placeholder={t('rules.allVehicles')}
                options={(vehiclesQuery.data ?? []).map((v) => ({
                  value: v.id,
                  label: v.plate ? `${v.name} · ${v.plate}` : v.name,
                }))}
              />
            )}
          />
          {needsThreshold && (
            <div className="grid grid-cols-2 gap-3">
              <Controller
                control={control}
                name="thresholdKmh"
                render={({ field }) => (
                  <Input {...field} type="number" min={1} label={t('rules.thresholdKmh')} />
                )}
              />
              <Controller
                control={control}
                name="gracePeriodSec"
                render={({ field }) => (
                  <Input {...field} type="number" min={0} label={t('rules.gracePeriodSec')} />
                )}
              />
            </div>
          )}
          {needsDuration && (
            <Controller
              control={control}
              name="minDurationSec"
              render={({ field }) => (
                <Input {...field} type="number" min={1} label={t('rules.minDurationSec')} />
              )}
            />
          )}
          {needsOffline && (
            <Controller
              control={control}
              name="minOfflineSec"
              render={({ field }) => (
                <Input {...field} type="number" min={1} label={t('rules.minOfflineSec')} />
              )}
            />
          )}
          {needsGeofence && (
            <Controller
              control={control}
              name="geofenceId"
              render={({ field }) => (
                <Select
                  {...field}
                  label={t('rules.geofenceId')}
                  placeholder={t('rules.allGeofences')}
                  options={(geofencesQuery.data ?? []).map((g) => ({
                    value: g.id,
                    label: g.name,
                  }))}
                />
              )}
            />
          )}
          {type === 'geofence_dwell' && (
            <Controller
              control={control}
              name="dwellSec"
              render={({ field }) => (
                <Input {...field} type="number" min={1} label={t('rules.dwellSec')} />
              )}
            />
          )}
          {needsTripMax && (
            <Controller
              control={control}
              name="maxDurationSec"
              render={({ field }) => (
                <Input {...field} type="number" min={1} label={t('rules.maxDurationSec')} />
              )}
            />
          )}
          {needsStopMax && (
            <Controller
              control={control}
              name="maxStopDurationSec"
              render={({ field }) => (
                <Input {...field} type="number" min={1} label={t('rules.maxStopDurationSec')} />
              )}
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <Controller
              control={control}
              name="cooldownSec"
              render={({ field }) => (
                <Input {...field} type="number" min={0} label={t('rules.cooldown')} />
              )}
            />
            <Controller
              control={control}
              name="dedupWindowSec"
              render={({ field }) => (
                <Input {...field} type="number" min={0} label={t('rules.dedup')} />
              )}
            />
          </div>
          <Controller
            control={control}
            name="repeatPolicy"
            render={({ field }) => (
              <Select
                {...field}
                label={t('rules.repeat')}
                options={REPEAT_POLICIES.map((p) => ({
                  value: p,
                  label: t(`rules.repeatPolicies.${p}`),
                }))}
              />
            )}
          />
        </form>
      </Drawer>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('rules.deleteConfirmTitle', { name: deleteTarget?.name ?? '' })}
        message={t('rules.deleteConfirmBody')}
        loading={deleteRule.isPending}
        onConfirm={onConfirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
