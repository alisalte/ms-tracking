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

import { useNotificationsPage } from '@/api/notification.api';
import { ErrorState } from '@/components/common/ErrorState';
import {
  Badge,
  Card,
  EmptyState,
  LoadMoreButton,
  PageHeader,
  Select,
  Spinner,
  Toolbar,
} from '@/components/tailwind-ui';
import { relativeTime } from '@/lib/relative-time';

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
function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function EventCenterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');

  const eventType = params.get('eventType') ?? undefined;
  const severity = params.get('severity') ?? undefined;

  const setFilter = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const page = useNotificationsPage({ eventType, severity });

  // Client search over title/body/vehicle.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return page.items;
    return page.items.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.body.toLowerCase().includes(q) ||
        (n.vehicleId?.toLowerCase().includes(q) ?? false),
    );
  }, [page.items, search]);

  // Group by calendar day, newest first.
  const groups = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const n of filtered) {
      const key = dayLabel(n.createdAt);
      const list = map.get(key) ?? [];
      list.push(n);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

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
                  label: t(`notifications.eventTypes.${type}`, {
                    defaultValue: type.replace(/_/g, ' '),
                  }),
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
                      onClick={() => n.link && navigate(n.link)}
                      className={`flex w-full items-start gap-3 border-b border-gray-100 px-5 py-3 text-start last:border-b-0 dark:border-white/5 ${
                        n.link
                          ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5'
                          : 'cursor-default'
                      }`}
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
                            {n.title}
                          </span>
                          <Badge color="gray" className="shrink-0">
                            {t(`notifications.eventTypes.${n.eventType}`, {
                              defaultValue: n.eventType.replace(/_/g, ' '),
                            })}
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
                          {n.body}
                          {n.vehicleId ? ` · ${n.vehicleId}` : ''}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-gray-400 dark:text-graydark-600">
                        {relativeTime(n.createdAt, t)}
                      </span>
                      {n.link && (
                        <ArrowRight
                          size={13}
                          aria-hidden
                          className="mt-1 shrink-0 text-gray-300 rtl:rotate-180 dark:text-graydark-500"
                        />
                      )}
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
    </div>
  );
}
