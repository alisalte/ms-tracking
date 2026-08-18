/**
 * AlarmDetailDrawer — the TailAdmin right slide-over showing the full alarm
 * entity (12_Alarm_Engine.md §6.1), the operator actions (§5.3
 * ack/resolve/contest), and the linked artifacts (§5.4 — source events,
 * position, driver/vehicle, clip/trip links). Phase 6 port.
 *
 * Follows the UI_UX §0.6 "selection → detail" pattern (row/marker → right
 * slide-over, never navigate away); Esc or backdrop closes. The overlay keeps
 * `role="presentation"` (test contract from the MUI Drawer).
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
  X,
} from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useAlarmDetail, useTransitionAlarm } from '@/api/alarm.api';
import { PERMISSIONS, PermissionGate } from '@/auth/permissions';
import { AlarmStatusBadge } from '@/components/alarms/AlarmStatusBadge';
import { alarmTypeIcon, severityColor } from '@/components/alarms/AlarmTypeIcon';
import { Button, IconButton, Spinner } from '@/components/tailwind-ui';
import type { Alarm } from '@/types/alarm.types';

/** Drawer width — slide-over (UI_UX §0.5). */
const DRAWER_WIDTH = 420;

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

  // Esc closes (parity with the MUI Drawer).
  useEffect(() => {
    if (!alarmId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [alarmId, onClose]);

  if (!alarmId) return null;

  return (
    <div role="presentation" className="fixed inset-0 z-50">
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('common.close')}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-gray-900/40"
      />
      <aside
        className="absolute inset-y-0 end-0 flex w-full flex-col bg-white shadow-2xl dark:bg-graydark-300"
        style={{ maxWidth: DRAWER_WIDTH }}
      >
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner size="lg" label={t('common.loading')} />
          </div>
        ) : alarm ? (
          <AlarmDetailContent
            alarm={alarm}
            onClose={onClose}
            onAction={(status) => transition.mutate({ id: alarm.id, status })}
            acting={transition.isPending}
          />
        ) : (
          <div className="p-8">
            <p className="text-sm text-gray-500 dark:text-graydark-600">
              {t('alarms.detail.notFound')}
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

/** The drawer body — extracted so the alarm is non-null inside it. */
function AlarmDetailContent({
  alarm,
  onClose,
  onAction,
  acting,
}: {
  alarm: Alarm;
  onClose: () => void;
  onAction: (status: Alarm['status']) => void;
  acting: boolean;
}) {
  const { t } = useTranslation();
  const Icon = alarmTypeIcon(alarm.type);
  const sevColor = severityColor(alarm.severity);
  const isResolved = alarm.status === 'resolved';

  return (
    <div className="fv-scroll relative flex-1 overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-[1] flex items-center gap-3 border-b border-gray-200 bg-white p-4 dark:border-white/5 dark:bg-graydark-300">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-white"
          style={{ backgroundColor: sevColor }}
        >
          <Icon size={20} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-gray-900 dark:text-white">
            {alarm.message}
          </p>
          <p className="truncate text-xs text-gray-500 dark:text-graydark-600">
            {alarm.vehicleLabel} · {t(`alarms.severity.${alarm.severity}`)}
          </p>
        </div>
        <AlarmStatusBadge status={alarm.status} label={t(`alarms.status.${alarm.status}`)} />
        <IconButton size="sm" onClick={onClose} aria-label={t('common.close')}>
          <X size={17} />
        </IconButton>
      </div>

      <div className="flex flex-col gap-5 p-4">
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
        {alarm.detail && (
          <div>
            <SectionLabel>{t('alarms.detail.description')}</SectionLabel>
            <p className="mt-1 text-sm text-gray-700 dark:text-graydark-700">{alarm.detail}</p>
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
                <span className="min-w-0 truncate">{e.detail}</span>
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
                <Button size="sm" variant="outline" leftIcon={<Video size={14} />}>
                  <Link to="/video">{t('alarms.detail.viewClip')}</Link>
                </Button>
              )}
              {alarm.linkedTripId && (
                <Button size="sm" variant="outline" leftIcon={<MapPin size={14} />}>
                  <Link to={`/trips/${alarm.linkedTripId}`}>{t('alarms.detail.viewTrip')}</Link>
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="border-t border-gray-200 dark:border-white/5" />

        {/* Operator actions (§5.3) — gated by the real backend permissions
            (notification.alert.ack / notification.alert.resolve). UX-only; the
            backend re-checks on every call (Sprint G Part 44). */}
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
