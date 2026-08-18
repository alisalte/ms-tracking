/**
 * EventCenterPage — the fleet event timeline (`/events`, Phase 6).
 *
 * Renders the notification-service's event stream (the platform's event bus —
 * every alarm-driven event carries eventType, vehicle, timestamp, severity)
 * as a chronological timeline grouped by day. Server-side filtered
 * (type/severity) + client search, cursor-paginated, URL-synced like the
 * Alarm Center; new events stream in over the WebSocket without reloads.
 *
 * Honest scope: this is the event surface the backend exposes today — there
 * is no separate telemetry-events endpoint, so nothing is fabricated. Route
 * is gated on `notification.read` (the permission the list API enforces).
 */
import { Activity, ArrowRight, Search, X } from 'lucide-react';
import { useMemo } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import { useNotificationsPage } from '@/api/notification.api';
import { ErrorState } from '@/components/common/ErrorState';
import { Badge, Card, EmptyState, Spinner } from '@/components/tailwind-ui';
import { useNotificationRealtime } from '@/hooks/useNotificationRealtime';
import { relativeTime } from '@/lib/relative-time';

const SEVERITIES = ['critical', 'high', 'normal', 'low'] as const;

/** Severity → Tailwind tone classes. */
function severityTone(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-400';
    case 'high':
      return 'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-400';
    case 'normal':
      return 'bg-info-50 text-info-700 dark:bg-info-500/10 dark:text-info-400';
    default:
      return 'bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-graydark-700';
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

  // Realtime: new events arrive over WS and patch the shared cache (no reload).
  useNotificationRealtime();

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
            {t('events.title', { defaultValue: 'Event Center' })}
          </h1>
          <p className="text-sm text-gray-500 dark:text-graydark-600">
            {t('events.subtitle', {
              defaultValue: 'Fleet event timeline — what happened, when, and to which vehicle',
            })}
          </p>
        </div>
        <Badge color="brand">
          <Activity size={13} aria-hidden className="me-1" />
          {t('dashboard.live')}
        </Badge>
      </div>

      {/* Filters */}
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <select
          value={eventType ?? ''}
          onChange={(e) => setFilter('eventType', e.target.value || null)}
          aria-label={t('notifications.center.filters.type', { defaultValue: 'Type' })}
          className="h-9 cursor-pointer rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
        >
          <option value="">{t('common.all', { defaultValue: 'All' })}</option>
          {Array.from(new Set(page.items.map((n) => n.eventType))).map((type) => (
            <option key={type} value={type}>
              {t(`notifications.eventTypes.${type}`, { defaultValue: type.replace(/_/g, ' ') })}
            </option>
          ))}
        </select>
        <select
          value={severity ?? ''}
          onChange={(e) => setFilter('severity', e.target.value || null)}
          aria-label={t('notifications.center.filters.severity', { defaultValue: 'Severity' })}
          className="h-9 cursor-pointer rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
        >
          <option value="">{t('common.all', { defaultValue: 'All' })}</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {t(`notifications.severity.${s}`, { defaultValue: s })}
            </option>
          ))}
        </select>
        <div className="flex h-9 min-w-56 items-center gap-1.5 rounded-lg bg-gray-100 px-3 dark:bg-white/5">
          <Search size={14} aria-hidden className="shrink-0 text-gray-400 dark:text-graydark-600" />
          <input
            placeholder={t('events.search', { defaultValue: 'Search events…' })}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t('events.search', { defaultValue: 'Search events' })}
            className="h-full w-full min-w-0 bg-transparent text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none dark:text-graydark-800 dark:placeholder:text-graydark-600"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="clear search"
              className="flex shrink-0 cursor-pointer border-none bg-transparent p-0 text-gray-400 hover:text-gray-600 dark:hover:text-graydark-700"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </Card>

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
                          <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-gray-300 px-2 text-[0.7rem] font-medium text-gray-600 dark:border-white/10 dark:text-graydark-700">
                            {t(`notifications.eventTypes.${n.eventType}`, {
                              defaultValue: n.eventType.replace(/_/g, ' '),
                            })}
                          </span>
                          <span
                            className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[0.7rem] font-semibold ${severityTone(n.severity)}`}
                          >
                            {t(`notifications.severity.${n.severity}`, {
                              defaultValue: n.severity,
                            })}
                          </span>
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
          {page.hasNextPage && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={page.fetchNextPage}
                disabled={page.isFetchingNextPage}
                data-testid="events-load-more"
                className="cursor-pointer rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-700 dark:hover:bg-white/5"
              >
                {page.isFetchingNextPage
                  ? t('common.loading', { defaultValue: 'Loading…' })
                  : t('common.loadMore', { defaultValue: 'Load more' })}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
