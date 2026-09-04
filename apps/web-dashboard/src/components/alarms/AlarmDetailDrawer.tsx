/**
 * AlarmDetailDrawer — the TailAdmin right slide-over showing the full alarm
 * entity (12_Alarm_Engine.md §6.1), the operator actions (§5.3
 * ack/resolve/contest), and the linked artifacts (§5.4 — source events,
 * position, driver/vehicle, clip/trip links). Phase 6 port.
 *
 * Follows the UI_UX §0.6 "selection → detail" pattern (row/marker → right
 * slide-over, never navigate away). The shared Drawer primitive provides the
 * backdrop, Esc-to-close and the dialog semantics (role="dialog" +
 * aria-modal). Ack/resolve mutations surface toast feedback and an inline
 * error banner on failure (the optimistic cache rollback lives in alarm.api).
 */
import {
  Car,
  ClipboardCheck,
  Clock,
  Flag,
  MapPin,
  ShieldQuestion,
  Truck,
  Video,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useAlarmDetail, useTransitionAlarm } from '@/api/alarm.api';
import { PERMISSIONS, PermissionGate } from '@/auth/permissions';
import { AlarmStatusBadge } from '@/components/alarms/AlarmStatusBadge';
import { alarmTypeIcon, severityBg } from '@/components/alarms/AlarmTypeIcon';
import { useToast } from '@/components/feedback/ToastProvider';
import { Alert, Button, Drawer, Spinner } from '@/components/tailwind-ui';
import { localizeAlarmDetail, localizeAlarmMessage, localizePhrase } from '@/lib/alarm-copy';
import type { Alarm } from '@/types/alarm.types';

interface AlarmDetailDrawerProps {
  /** The selected alarm id, or null to keep the drawer closed. */
  alarmId: string | null;
  /** Close the drawer. */
  onClose: () => void;
}

export function AlarmDetailDrawer({ alarmId, onClose }: AlarmDetailDrawerProps) {
  const { t } = useTranslation();
  const { data: alarm, isLoading } = useAlarmDetail(alarmId);
  const transition = useTransitionAlarm();
  const toast = useToast();

  // Ack/resolve → toast on outcome (the mutation itself is optimistic).
  const handleAction = (status: Alarm['status']) => {
    if (!alarm) return;
    transition.mutate(
      { id: alarm.id, status },
      {
        onSuccess: (_updated, vars) =>
          toast.success(
            t(vars.status === 'resolved' ? 'alarms.toast.resolved' : 'alarms.toast.acked'),
          ),
        onError: (err) => toast.error(err),
      },
    );
  };

  const Icon = alarm ? alarmTypeIcon(alarm.type) : null;

  return (
    <Drawer
      open={alarmId !== null}
      onClose={onClose}
      size="md"
      title={
        alarm ? (
          <span className="flex min-w-0 items-center gap-2">
            {Icon && (
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-white ${severityBg(alarm.severity)}`}
              >
                <Icon size={15} aria-hidden />
              </span>
            )}
            <span className="truncate">{localizeAlarmMessage(t, alarm)}</span>
            <span className="shrink-0">
              <AlarmStatusBadge status={alarm.status} label={t(`alarms.status.${alarm.status}`)} />
            </span>
          </span>
        ) : (
          t('alarms.detail.heading')
        )
      }
      subtitle={
        alarm ? `${alarm.vehicleLabel} · ${t(`alarms.severity.${alarm.severity}`)}` : undefined
      }
    >
      {isLoading ? (
        <div className="flex min-h-48 items-center justify-center">
          <Spinner size="lg" label={t('common.loading')} />
        </div>
      ) : alarm ? (
        <AlarmDetailContent
          alarm={alarm}
          onAction={handleAction}
          acting={transition.isPending}
          actionFailed={transition.isError}
        />
      ) : (
        <p className="text-sm text-gray-500 dark:text-graydark-600">
          {t('alarms.detail.notFound')}
        </p>
      )}
    </Drawer>
  );
}

/** The drawer body — extracted so the alarm is non-null inside it. */
function AlarmDetailContent({
  alarm,
  onAction,
  acting,
  actionFailed,
}: {
  alarm: Alarm;
  onAction: (status: Alarm['status']) => void;
  acting: boolean;
  actionFailed: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isResolved = alarm.status === 'resolved';

  return (
    <div className="flex flex-col gap-5">
      {/* Meta grid */}
      <div className="flex flex-col gap-2">
        <DetailRow
          icon={<Truck size={16} />}
          label={t('alarms.detail.vehicle')}
          value={alarm.vehicleLabel}
        />
        {alarm.driver && (
          <DetailRow
            icon={<Car size={16} />}
            label={t('alarms.detail.driver')}
            value={alarm.driver}
          />
        )}
        <DetailRow
          icon={<MapPin size={16} />}
          label={t('alarms.detail.location')}
          value={alarm.address}
        />
        <DetailRow
          icon={<Clock size={16} />}
          label={t('alarms.detail.raised')}
          value={fmt(alarm.raisedAt)}
        />
        {alarm.ackedAt && (
          <DetailRow
            icon={<ClipboardCheck size={16} />}
            label={t('alarms.detail.acked')}
            value={fmt(alarm.ackedAt)}
          />
        )}
        {alarm.resolvedAt && (
          <DetailRow
            icon={<ShieldQuestion size={16} />}
            label={t('alarms.detail.resolved')}
            value={fmt(alarm.resolvedAt)}
          />
        )}
        {alarm.escalationStep > 0 && (
          <DetailRow
            icon={<Flag size={16} />}
            label={t('alarms.detail.escalation')}
            value={t('alarms.detail.escalationStep', { step: alarm.escalationStep })}
          />
        )}
      </div>

      {/* Detail / description */}
      {localizeAlarmDetail(t, alarm) && (
        <div>
          <SectionLabel>{t('alarms.detail.description')}</SectionLabel>
          <p className="mt-1 text-sm text-gray-700 dark:text-graydark-700">
            {localizeAlarmDetail(t, alarm)}
          </p>
        </div>
      )}

      {/* Source events */}
      <div>
        <SectionLabel>{t('alarms.detail.sourceEvents')}</SectionLabel>
        <div className="mt-1.5 flex flex-col gap-1">
          {alarm.sourceEvents.map((e) => (
            <div
              key={e.id}
              className="flex items-center gap-2 text-sm text-gray-500 dark:text-graydark-600"
            >
              <span className="inline-flex h-[18px] items-center rounded-full bg-gray-100 px-1.5 font-mono text-[0.6rem] dark:bg-white/5">
                {e.type}
              </span>
              <span className="min-w-0 truncate">{localizePhrase(t, e.detail)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Linked artifacts */}
      {(alarm.linkedClipId || alarm.linkedTripId) && (
        <div>
          <SectionLabel>{t('alarms.detail.linked')}</SectionLabel>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {alarm.linkedClipId && (
              <Button
                size="sm"
                variant="outline"
                leftIcon={<Video size={14} />}
                onClick={() => navigate('/video')}
              >
                {t('alarms.detail.viewClip')}
              </Button>
            )}
            {alarm.linkedTripId && (
              <Button
                size="sm"
                variant="outline"
                leftIcon={<MapPin size={14} />}
                onClick={() => navigate(`/trips/${alarm.linkedTripId}`)}
              >
                {t('alarms.detail.viewTrip')}
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="border-t border-gray-200 dark:border-white/5" />

      {/* Operator actions (§5.3) — gated by the real backend permissions
          (notification.alert.ack / notification.alert.resolve). UX-only; the
          backend re-checks on every call (Sprint G Part 44). */}
      {actionFailed && <Alert variant="danger">{t('alarms.detail.actionFailed')}</Alert>}
      <div className="flex flex-wrap gap-2">
        {!isResolved && alarm.status !== 'acked' && (
          <PermissionGate requires={PERMISSIONS.alertAck}>
            <Button size="sm" disabled={acting} onClick={() => onAction('acked')}>
              {t('alarms.actions.ack')}
            </Button>
          </PermissionGate>
        )}
        {!isResolved && (
          <PermissionGate requires={PERMISSIONS.alertResolve}>
            <Button
              size="sm"
              variant="outline"
              disabled={acting}
              onClick={() => onAction('resolved')}
            >
              {t('alarms.actions.resolve')}
            </Button>
          </PermissionGate>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-graydark-600">
      {children}
    </p>
  );
}

/** A key/value row with a leading icon. */
function DetailRow({
  icon,
  label,
  value,
}: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex shrink-0 text-gray-400 dark:text-graydark-600">{icon}</span>
      <span className="min-w-[90px] text-sm text-gray-500 dark:text-graydark-600">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-graydark-800">
        {value}
      </span>
    </div>
  );
}

/** Locale-aware timestamp formatter. */
function fmt(iso: string): string {
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}
