import { useQuery } from '@tanstack/react-query';
import {
  Clock,
  Gauge,
  History,
  type LucideIcon,
  MapPin,
  MessageSquare,
  Navigation,
  PlayCircle,
  Power,
  Route,
  Satellite,
  User,
  Video,
  X,
} from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { type AlarmListParams, fetchAlarms } from '@/api/alarm.api';
import { useVehicleDetail } from '@/api/fleet.api';
import { useReverseGeocode } from '@/api/map.api';
import { ErrorState } from '@/components/common/ErrorState';
import { LiveBadge } from '@/components/dashboard/LiveBadge';
import { Badge, IconButton, Skeleton } from '@/components/tailwind-ui';
import { lastSeenLabel } from '@/lib/relative-time';
import { status } from '@/theme/palette';

const DRAWER_WIDTH = 360;

interface DevicePopupProps {
  /** Vehicle id to show; `null` closes the drawer. */
  vehicleId: string | null;
  onClose: () => void;
  /** Switch the map to HISTORY mode for this vehicle (Sprint F §20). */
  onShowHistory?: () => void;
  /** Toggle live follow (map keeps re-centering on this vehicle). */
  onToggleFollow?: () => void;
  /** Whether follow mode is currently active for this vehicle. */
  following?: boolean;
}

/**
 * DevicePopup — right slide-over drawer (Phase 5).
 *
 * The control center for one vehicle: status header + live dot, quick facts
 * (speed/heading/ignition/driver/last-seen/address), recent alerts (live from
 * the notification service, filtered per vehicle), and quick actions:
 *
 * - دنبال‌کردن — live follow: the map re-centers on every position update.
 * - ویدیوی زنده — the video wall preselects this vehicle's device (`?d=`).
 * - خط زمانی سفر — the trips page filtered to this vehicle (`?vehicle=`).
 * - پیام/فرمان — the command center with the device preselected (`?device=`).
 * - تاریخچه — history playback for this vehicle on the map.
 *
 * Actions that need a LIVE device are disabled for offline vehicles — honest
 * affordances, never dead buttons. Backed by `useVehicleDetail`.
 */
export function DevicePopup({
  vehicleId,
  onClose,
  onShowHistory,
  onToggleFollow,
  following = false,
}: DevicePopupProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useVehicleDetail(vehicleId);

  // Recent alerts for THIS vehicle (mock mode falls back to fixtures internally).
  const alerts = useQuery({
    queryKey: ['alarms', 'vehicle', vehicleId],
    queryFn: () => fetchAlarms({ vehicleId: vehicleId ?? undefined, limit: 5 } as AlarmListParams),
    enabled: Boolean(vehicleId),
    staleTime: 15_000,
  });

  // Sprint F §13 — reverse geocode ONLY the selected vehicle's position
  // (justified event; the backend caches by rounded coordinate in Redis).
  const hasFix = data !== undefined && (data.lat !== 0 || data.lng !== 0);
  const reverse = useReverseGeocode(hasFix ? data.lat : null, hasFix ? data.lng : null);

  // ESC closes the drawer.
  useEffect(() => {
    if (!vehicleId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [vehicleId, onClose]);

  if (!vehicleId) return null;

  const live = data?.presence === 'ONLINE';

  return (
    <div role="presentation" className="absolute inset-0 z-40" data-testid="device-popup-overlay">
      {/* Backdrop — click closes without clearing the selection (§31). */}
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('map.popup.close')}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-gray-900/25"
      />
      <aside
        className="absolute inset-y-0 end-0 flex w-full flex-col bg-white shadow-xl sm:w-[var(--drawer-w)] dark:bg-graydark-300"
        style={{ ['--drawer-w' as string]: `${DRAWER_WIDTH}px` }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5 dark:border-white/5">
          <div className="flex min-w-0 items-center gap-2">
            {isLoading || !data ? (
              <Skeleton className="h-6 w-28" />
            ) : (
              <>
                <h2 className="truncate text-lg font-bold text-gray-900 dark:text-white">
                  {data.label}
                </h2>
                {data.state === 'driving' && <LiveBadge />}
              </>
            )}
          </div>
          <IconButton size="sm" onClick={onClose} aria-label={t('map.popup.close')}>
            <X size={17} />
          </IconButton>
        </div>

        {isError ? (
          // §22: the real backend is unreachable — honest error, never fake data.
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : isLoading || !data ? (
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          <div className="fv-scroll min-h-0 flex-1 overflow-y-auto p-4">
            {/* Status + presence pills (§18) */}
            <div className="mb-4 flex flex-wrap gap-1.5">
              <Badge color={live ? 'warning' : 'gray'}>{t(`map.states.${data.state}`)}</Badge>
              <Badge color={live ? 'success' : 'gray'}>
                {t(`map.presence.${data.presence ?? 'UNKNOWN'}`)}
              </Badge>
            </div>

            {/* ── Quick facts grid ── */}
            <div className="mb-4 grid grid-cols-2 gap-2.5">
              <Fact
                icon={Gauge}
                label={t('map.popup.speed')}
                value={`${data.speed} km/h`}
                tone="brand"
              />
              <Fact
                icon={Navigation}
                label={t('map.popup.heading')}
                value={`${data.heading}°`}
                tone="info"
              />
              <Fact
                icon={Power}
                label={t('map.popup.ignition')}
                value={data.ignitionOn ? t('map.popup.ignitionOn') : t('map.popup.ignitionOff')}
                tone={data.ignitionOn ? 'success' : 'gray'}
              />
              <Fact
                icon={Route}
                label={t('map.popup.odometer')}
                value={fmtKm(data.odometer)}
                tone="gray"
              />
              <Fact
                icon={User}
                label={t('map.popup.driver')}
                value={data.driver ?? t('map.popup.unassigned')}
                tone="gray"
              />
              {/* §19 Last seen — device status last_seen, falling back to the fix. */}
              <Fact
                icon={Satellite}
                label={t('map.lastSeen.label')}
                value={lastSeenLabel(data.lastSeenAt, t)}
                tone={live ? 'success' : 'gray'}
              />
            </div>

            <Fact
              icon={MapPin}
              label={t('map.popup.address')}
              value={
                !hasFix
                  ? '—'
                  : reverse.isLoading
                    ? t('common.loading')
                    : reverse.isError
                      ? // No geocoder (Nominatim is an external opt-in) — honest
                        // coordinate fallback instead of a dead "unavailable".
                        `${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}`
                      : (reverse.data?.formatted ??
                        `${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}`)
              }
              fullWidth
            />

            {/* ── Quick actions ── */}
            <p className="mt-4 mb-2 text-sm font-semibold text-gray-800 dark:text-white">
              {t('map.popup.actions')}
            </p>
            <div className="mb-4 grid grid-cols-2 gap-1.5">
              <ActionButton
                icon={Navigation}
                label={t('map.popup.follow')}
                primary={following}
                active={following}
                disabled={!live}
                title={live ? undefined : t('map.popup.offlineAction')}
                onClick={onToggleFollow}
              />
              <ActionButton
                icon={Video}
                label={t('map.popup.liveVideo')}
                disabled={!live || !data.deviceId}
                title={live ? undefined : t('map.popup.offlineAction')}
                onClick={() => data.deviceId && navigate(`/video?d=${data.deviceId}`)}
              />
              <ActionButton
                icon={History}
                label={t('map.popup.tripTimeline')}
                onClick={() => navigate(`/trips?vehicle=${data.id}`)}
              />
              <ActionButton
                icon={MessageSquare}
                label={t('map.popup.sendMessage')}
                disabled={!data.deviceId}
                onClick={() => data.deviceId && navigate(`/commands?device=${data.deviceId}`)}
              />
              <ActionButton
                icon={Clock}
                label={t('map.popup.history')}
                className="col-span-2"
                onClick={onShowHistory}
              />
            </div>

            <div className="my-2 border-t border-gray-200 dark:border-white/5" />

            {/* ── Recent events (real alerts for this vehicle) ── */}
            <p className="mt-2 mb-2 text-sm font-semibold text-gray-800 dark:text-white">
              {t('map.popup.recentEvents')}
            </p>
            {alerts.isLoading ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : alerts.isError || (alerts.data ?? []).length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-graydark-600">
                {t('map.popup.noEvents')}
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {(alerts.data ?? []).map((a) => (
                  <div key={a.id} className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: SEVERITY_COLOR[a.severity] ?? status.slate }}
                    />
                    <p className="min-w-0 flex-1 text-sm text-gray-800 dark:text-graydark-800">
                      {t(`alarms.type.${a.type}`)}
                      <span className="text-xs text-gray-500 dark:text-graydark-600">
                        {' · '}
                        {a.message}
                      </span>
                    </p>
                    <span className="shrink-0 text-[0.65rem] text-gray-400 tabular-nums dark:text-graydark-500">
                      {lastSeenLabel(a.raisedAt, t)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {data.state === 'driving' && (
              <button
                type="button"
                onClick={onShowHistory}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-teal-500/30 bg-teal-500/8 px-3 py-2.5 text-sm font-bold text-teal-700 transition-colors hover:bg-teal-500/15 dark:text-teal-300"
              >
                <PlayCircle size={16} aria-hidden />
                {t('map.popup.playbackToday')}
              </button>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

/** Severity dot color for the recent-events list. */
const SEVERITY_COLOR: Record<string, string> = {
  critical: status.red,
  major: status.amber,
  minor: status.info,
  info: status.slate,
};

/** Compact key/value fact with an icon in a tinted chip. */
function Fact({
  icon: Icon,
  label,
  value,
  fullWidth,
  tone = 'gray',
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  fullWidth?: boolean;
  tone?: 'brand' | 'success' | 'warning' | 'info' | 'gray';
}) {
  const chip = {
    brand: 'bg-brand-500/10 text-brand-600 dark:text-brand-300',
    success: 'bg-success-500/10 text-success-600 dark:text-success-400',
    warning: 'bg-warning-500/12 text-warning-600 dark:text-warning-400',
    info: 'bg-info-500/10 text-info-600 dark:text-info-400',
    gray: 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-graydark-600',
  }[tone];
  return (
    <div className={`flex min-w-0 items-center gap-2 ${fullWidth ? 'col-span-2' : ''}`}>
      <span
        aria-hidden
        className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4 ${chip}`}
      >
        <Icon />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 dark:text-graydark-600">{label}</p>
        <p className="truncate text-sm font-medium tabular-nums text-gray-800 dark:text-graydark-800">
          {value}
        </p>
      </div>
    </div>
  );
}

/** Quick-action button — wired actions only; disabled affordances carry a title. */
function ActionButton({
  icon: Icon,
  label,
  primary,
  active,
  disabled,
  title,
  onClick,
  className = '',
}: {
  icon: LucideIcon;
  label: string;
  primary?: boolean;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-brand-500 bg-brand-500 text-white'
          : primary
            ? 'border-brand-500/40 bg-brand-500/10 text-brand-600 hover:bg-brand-500/15 dark:text-brand-300'
            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-transparent dark:text-graydark-700 dark:hover:bg-white/5'
      } ${className}`}
    >
      <Icon size={14} aria-hidden />
      {label}
    </button>
  );
}

/** Kilometer formatting (backend reports meters when available; 0 = unknown). */
function fmtKm(m: number): string {
  if (!m) return '—';
  return `${(m / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`;
}
