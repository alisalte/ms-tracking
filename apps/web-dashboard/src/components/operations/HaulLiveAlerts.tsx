/**
 * Live alerts for the loading and unloading limits of a haul route.
 *
 * Turns the limits shown by the analysis into geofence dwell alerts (see
 * lib/haul-alerts.ts): a truck that stays in the origin or the destination
 * longer than the limit raises an alarm while it is still there.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getApiErrorMessage } from '@/api/errors';
import { useGeofences, useUpdateGeofence } from '@/api/geofence.api';
import { type HaulAnalysisReport, useHaulRoutes } from '@/api/operations.api';
import {
  useAlarmRules,
  useCreateAlarmRule,
  useDeleteAlarmRule,
  useEnableAlarmRule,
  useUpdateAlarmRule,
} from '@/api/rule.api';
import { Panel } from '@/components/operations/ops-ui';
import { Alert, Badge, Button, Input } from '@/components/tailwind-ui';
import {
  type HaulAlertKind,
  type HaulAlertLimits,
  haulAlertStatus,
  isEmptyPlan,
  planHaulAlerts,
} from '@/lib/haul-alerts';

const KINDS: HaulAlertKind[] = ['load', 'unload'];

function suggestedMin(sec: number | null): string {
  return sec === null ? '' : String(Math.max(1, Math.ceil(sec / 60)));
}

/** Minutes typed by the operator → seconds; blank or invalid = no alert. */
function toSec(value: string): number | null {
  const minutes = Number(value);
  if (!value.trim() || !Number.isFinite(minutes) || minutes < 1) return null;
  return Math.round(minutes * 60);
}

export function HaulLiveAlerts({
  routeId,
  analysis,
}: {
  routeId: string;
  analysis: HaulAnalysisReport;
}) {
  const { t } = useTranslation();
  const a = (key: string, options?: Record<string, unknown>) =>
    t(`operations.analysis.alerts.${key}`, options);
  const routes = useHaulRoutes();
  const geofences = useGeofences();
  const rules = useAlarmRules();
  const updateGeofence = useUpdateGeofence();
  const createRule = useCreateAlarmRule();
  const updateRule = useUpdateAlarmRule();
  const enableRule = useEnableAlarmRule();
  const deleteRule = useDeleteAlarmRule();
  const [edited, setEdited] = useState<Partial<Record<HaulAlertKind, string>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const route = (routes.data ?? []).find((row) => row.id === routeId) ?? null;
  const fence = (id: string | undefined) =>
    (geofences.data ?? []).find((place) => place.id === id) ?? null;
  const origin = fence(route?.originGeofenceId);
  const destination = fence(route?.destinationGeofenceId);
  const trucks = analysis.byVehicle.map((row) => ({
    vehicleId: row.vehicleId,
    vehicleName: row.vehicleName,
  }));
  const allRules = rules.data ?? [];
  const status = haulAlertStatus(allRules, routeId, trucks.length);

  const suggested: Record<HaulAlertKind, number | null> = {
    load: analysis.controlLimits.loadSec,
    unload: analysis.controlLimits.unloadSec,
  };
  const value = (kind: HaulAlertKind): string =>
    edited[kind] ?? suggestedMin(status[kind].limitSec ?? suggested[kind]);
  const limits: HaulAlertLimits = {
    load: toSec(value('load')),
    unload: toSec(value('unload')),
  };

  const labels = { load: a('ruleLoad'), unload: a('ruleUnload') };
  const plan = route
    ? planHaulAlerts({
        routeId,
        routeName: route.name,
        origin,
        destination,
        trucks,
        limits,
        rules: allRules,
        labels,
      })
    : null;
  const turnOff = route
    ? planHaulAlerts({
        routeId,
        routeName: route.name,
        origin,
        destination,
        trucks,
        limits: { load: null, unload: null },
        rules: allRules,
        labels,
      })
    : null;

  const run = async (target: NonNullable<typeof plan>) => {
    setBusy(true);
    setMessage(null);
    try {
      for (const change of target.fences) {
        await updateGeofence.mutateAsync({
          id: change.geofenceId,
          payload: { alertOn: change.alertOn, dwellSec: change.toDwellSec },
        });
      }
      for (const payload of target.creates) await createRule.mutateAsync(payload);
      for (const { id, changes } of target.updates) await updateRule.mutateAsync({ id, changes });
      for (const id of target.enables) await enableRule.mutateAsync(id);
      for (const id of target.deletes) await deleteRule.mutateAsync(id);
      setEdited({});
      setMessage({ ok: true, text: a('done') });
    } catch (err) {
      setMessage({ ok: false, text: `${a('failed')} ${getApiErrorMessage(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const anyActive = status.load.active + status.unload.active > 0;
  const missing = !route || !origin || !destination;

  return (
    <Panel title={a('title')} hint={a('hint')} testId="haul-live-alerts">
      {missing && !routes.isLoading && !geofences.isLoading && (
        <Alert variant="warning" className="mb-3">
          {a('missingFence')}
        </Alert>
      )}

      <div className="flex flex-wrap items-end gap-4">
        {KINDS.map((kind) => (
          <Input
            key={kind}
            label={a(`limit.${kind}`)}
            type="number"
            min={1}
            max={1440}
            inputMode="numeric"
            placeholder={a('off')}
            data-testid={`alert-limit-${kind}`}
            wrapperClassName="w-60"
            value={value(kind)}
            onChange={(event) => setEdited((prev) => ({ ...prev, [kind]: event.target.value }))}
          />
        ))}
        <Button
          size="sm"
          disabled={busy || missing || !plan || isEmptyPlan(plan)}
          data-testid="alerts-apply"
          onClick={() => plan && void run(plan)}
        >
          {anyActive ? a('update') : a('enable')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !turnOff || turnOff.deletes.length === 0}
          data-testid="alerts-off"
          onClick={() => turnOff && void run(turnOff)}
        >
          {a('disable')}
        </Button>
      </div>

      <ul className="mt-4 flex flex-col gap-2 text-sm" data-testid="alerts-status">
        {KINDS.map((kind) => (
          <li key={kind} className="flex flex-wrap items-center gap-2">
            <span className="text-gray-600 dark:text-graydark-700">{a(`limit.${kind}`)}:</span>
            <Badge color={status[kind].active === 0 ? 'gray' : 'success'} dot>
              {status[kind].active === 0
                ? a('statusOff')
                : a('statusOn', {
                    minutes: Math.round((status[kind].limitSec ?? 0) / 60),
                    active: status[kind].active,
                    trucks: status[kind].trucks,
                  })}
            </Badge>
          </li>
        ))}
      </ul>

      {plan && plan.fences.length > 0 && (
        <div
          className="mt-3 text-xs text-gray-600 dark:text-graydark-700"
          data-testid="alerts-fence-changes"
        >
          <div className="font-medium">{a('fenceChanges')}</div>
          <ul className="mt-1 list-disc space-y-0.5 ps-5">
            {plan.fences.map((change) => (
              <li key={change.geofenceId}>
                {a('fenceChange', {
                  name: change.name,
                  from:
                    change.fromDwellSec === null ? a('none') : Math.round(change.fromDwellSec / 60),
                  to: Math.round(change.toDwellSec / 60),
                })}
                {change.inactive && (
                  <span className="ms-1 text-warning-700">{a('fenceInactive')}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-xs text-gray-500 dark:text-graydark-600">{a('latency')}</p>
      {message && (
        <Alert variant={message.ok ? 'success' : 'danger'} className="mt-3">
          <span data-testid="alerts-message">{message.text}</span>
        </Alert>
      )}
    </Panel>
  );
}
