/**
 * EventCenterPage — the fleet event timeline (`/events`, Phase 6).
 *
 * Renders the notification-service's event stream (the platform's event bus —
 * every alarm-driven event carries eventType, vehicle, timestamp, severity)
 * as a chronological timeline grouped by day. Server-side filtered
 * (type/severity) + client search, cursor-paginated, URL-synced like the
 * Alarm Center. Live rows arrive via the header bell's Socket.IO hook
 * (shared React Query cache — no extra WebSocket from this page).
 *
 * Honest scope: this is the event surface the backend exposes today — there
 * is no separate telemetry-events endpoint, so nothing is fabricated. Route
 * is gated on `notification.read` (the permission the list API enforces).
 */
import { Activity, ArrowRight } from 'lucide-react';
import { useMemo } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import { useVehicles } from '@/api/asset.api';
import { useNotificationsPage } from '@/api/notification.api';
import { ErrorState } from '@/components/common/ErrorState';
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  LoadMoreButton,
  PageHeader,
  Select,
  Spinner,
  Toolbar,
} from '@/components/tailwind-ui';
import {
  localizeEventType,
  localizeNotificationBody,
  localizeNotificationTitle,
} from '@/lib/alarm-copy';
import { displayLabel } from '@/lib/ids';
import { relativeTime } from '@/lib/relative-time';
import { formatVehicleLabel } from '@/lib/vehicle-label';
import type { Notification } from '@/types/notification.types';

const SEVERITIES = ['critical', 'high', 'normal', 'low'] as const;

/** Severity → Badge color (semantic palette). */
function severityBadgeColor(severity: string): 'danger' | 'warning' | 'info' | 'gray' {
  switch (severity) {
    case 'critical':
      return 'danger';
    case 'high':
      return 'warning';
    case 'normal':
      return 'info';
    default:
      return 'gray';
  }
}

/** Day bucket label (locale date; grouping key doubles as the heading). */
function dayLabel(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale.startsWith('fa') ? 'fa-IR' : locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function EventCenterPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: vehicles } = useVehicles();

  const eventType = params.get('eventType') ?? undefined;
  const severity = params.get('severity') ?? undefined;

  const setFilter = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const page = useNotificationsPage({ eventType, severity });

  // Client search over localized title/body/type plus vehicle id.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return page.items;
    return page.items.filter((n) => {
      const title = localizeNotificationTitle(t, n).toLowerCase();
      const body = localizeNotificationBody(t, n).toLowerCase();
      const type = localizeEventType(t, n.eventType).toLowerCase();
      return (
        title.includes(q) ||
        body.includes(q) ||
        type.includes(q) ||
        n.title.toLowerCase().includes(q) ||
        n.body.toLowerCase().includes(q) ||
        (n.vehicleId?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [page.items, search, t]);

  // Group by calendar day, newest first.
  const groups = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const n of filtered) {
      const key = dayLabel(n.createdAt, i18n.language);
      const list = map.get(key) ?? [];
      list.push(n);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [filtered, i18n.language]);

  const vehicleLabelOf = useMemo(() => {
    const labels = new Map((vehicles ?? []).map((v) => [v.id, formatVehicleLabel(v)] as const));
    return (id: string | undefined) => {
      if (!id) return '';
      return labels.get(id) || displayLabel(id) || '';
    };
  }, [vehicles]);

  const selected =
    filtered.find((n) => n.id === selectedId) ?? page.items.find((n) => n.id === selectedId);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <PageHeader
        title={t('events.title', { defaultValue: 'Event Center' })}
        description={t('events.subtitle', {
          defaultValue: 'Fleet event timeline — what happened, when, and to which vehicle',
        })}
        actions={
          <Badge color="brand">
            <Activity size={13} aria-hidden className="me-1" />
            {t('dashboard.live')}
          </Badge>
        }
      />

      {/* Filters */}
      <Toolbar
        search
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('events.search', { defaultValue: 'Search events…' })}
        left={
          <>
            <Select
              value={eventType ?? ''}
              onChange={(e) => setFilter('eventType', e.target.value || null)}
              wrapperClassName="w-44"
              aria-label={t('notifications.center.filters.type', { defaultValue: 'Type' })}
              options={[
                { value: '', label: t('common.all', { defaultValue: 'All' }) },
                ...Array.from(new Set(page.items.map((n) => n.eventType))).map((type) => ({
                  value: type,
                  label: localizeEventType(t, type),
                })),
              ]}
            />
            <Select
              value={severity ?? ''}
              onChange={(e) => setFilter('severity', e.target.value || null)}
              wrapperClassName="w-36"
              aria-label={t('notifications.center.filters.severity', { defaultValue: 'Severity' })}
              options={[
                { value: '', label: t('common.all', { defaultValue: 'All' }) },
                ...SEVERITIES.map((s) => ({
                  value: s,
                  label: t(`notifications.severity.${s}`, { defaultValue: s }),
                })),
              ]}
            />
          </>
        }
      />

      {/* Timeline */}
      {page.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" label={t('common.loading')} />
        </div>
      ) : page.isError ? (
        <ErrorState error={page.error} onRetry={() => page.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Activity />}
          title={t('events.empty', { defaultValue: 'No events yet' })}
          description={t('events.emptyHelp', {
            defaultValue: 'Fleet events will appear here as they happen.',
          })}
        />
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map(([day, events]) => (
            <Card key={day} flush>
              <div className="border-b border-gray-100 px-5 py-3 dark:border-white/5">
                <p className="text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-graydark-600">
                  {day}
                </p>
              </div>
              <ul className="m-0 list-none p-0">
                {events.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(n.id)}
                      className="flex w-full cursor-pointer items-start gap-3 border-b border-gray-100 px-5 py-3 text-start last:border-b-0 hover:bg-gray-50 dark:border-white/5 dark:hover:bg-white/5"
                    >
                      {/* Timeline rail dot */}
                      <span className="relative mt-1.5 flex size-2.5 shrink-0">
                        <span
                          className={`size-2.5 rounded-full ${n.severity === 'critical' ? 'bg-danger-500' : n.severity === 'high' ? 'bg-warning-500' : 'bg-info-500'}`}
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-semibold text-gray-800 dark:text-graydark-800">
                            {localizeNotificationTitle(t, n)}
                          </span>
                          <Badge color="gray" className="shrink-0">
                            {localizeEventType(t, n.eventType)}
                          </Badge>
                          <Badge
                            color={severityBadgeColor(n.severity)}
                            className="shrink-0 font-semibold"
                          >
                            {t(`notifications.severity.${n.severity}`, {
                              defaultValue: n.severity,
                            })}
                          </Badge>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-graydark-600">
                          {localizeNotificationBody(t, n)}
                          {n.vehicleId ? ` · ${vehicleLabelOf(n.vehicleId) || n.vehicleId}` : ''}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-gray-400 dark:text-graydark-600">
                        {relativeTime(n.createdAt, t)}
                      </span>
                      <ArrowRight
                        size={13}
                        aria-hidden
                        className="mt-1 shrink-0 text-gray-300 rtl:rotate-180 dark:text-graydark-500"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
          <LoadMoreButton
            hasNextPage={page.hasNextPage}
            isFetchingNextPage={page.isFetchingNextPage}
            onClick={() => page.fetchNextPage()}
            testId="events-load-more"
          />
        </div>
      )}

      <Drawer
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
        size="md"
        title={
          selected
            ? localizeNotificationTitle(t, selected)
            : t('events.detail.heading', { defaultValue: 'Event detail' })
        }
        subtitle={
          selected
            ? `${localizeEventType(t, selected.eventType)} · ${t(`notifications.severity.${selected.severity}`, { defaultValue: selected.severity })}`
            : undefined
        }
      >
        {selected ? (
          <EventDetailContent
            event={selected}
            vehicleLabel={vehicleLabelOf(selected.vehicleId) || selected.vehicleId || '—'}
            onOpenAlarm={
              selected.link
                ? () => {
                    navigate(selected.link as string);
                  }
                : undefined
            }
          />
        ) : (
          <div className="flex min-h-48 items-center justify-center">
            <Spinner size="lg" label={t('common.loading')} />
          </div>
        )}
      </Drawer>
    </div>
  );
}

function EventDetailContent({
  event,
  vehicleLabel,
  onOpenAlarm,
}: {
  event: Notification;
  vehicleLabel: string;
  onOpenAlarm?: () => void;
}) {
  const { t } = useTranslation();
  const when = event.createdAt ? new Date(event.createdAt) : null;
  const whenLabel =
    when && !Number.isNaN(when.getTime())
      ? when.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
      : '—';

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-gray-700 dark:text-graydark-700">
        {localizeNotificationBody(t, event)}
      </p>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <span className="min-w-[90px] text-sm text-gray-500 dark:text-graydark-600">
            {t('alarms.detail.vehicle')}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-graydark-800">
            {vehicleLabel}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="min-w-[90px] text-sm text-gray-500 dark:text-graydark-600">
            {t('events.detail.time', { defaultValue: 'Time' })}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-graydark-800">
            {whenLabel}
          </span>
        </div>
      </div>
      {onOpenAlarm ? (
        <Button size="sm" variant="outline" onClick={onOpenAlarm}>
          {t('events.detail.openAlarm', { defaultValue: 'Open related alarm' })}
        </Button>
      ) : null}
    </div>
  );
}
