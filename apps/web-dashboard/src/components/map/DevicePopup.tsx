import {
  Gauge,
  History,
  type LucideIcon,
  MapPin,
  Navigation,
  Power,
  Send,
  User,
  Video,
  X,
} from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useVehicleDetail } from '@/api/fleet.api';
import { useReverseGeocode } from '@/api/map.api';
import { ErrorState } from '@/components/common/ErrorState';
import { LiveBadge } from '@/components/dashboard/LiveBadge';
import { Badge, IconButton, Skeleton } from '@/components/tailwind-ui';
import { lastSeenLabel } from '@/lib/relative-time';
import { status } from '@/theme/palette';
import type { AlertSeverity } from '@/types/fleet.types';

const DRAWER_WIDTH = 360;

/** Severity → semantic color for the recent-events list. */
const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  critical: status.red,
  warning: status.amber,
  info: status.slate,
};

interface DevicePopupProps {
  /** Vehicle id to show; `null` closes the drawer. */
  vehicleId: string | null;
  onClose: () => void;
  /** Switch the map to HISTORY mode for this vehicle (Sprint F §20). */
  onShowHistory?: () => void;
}

/**
 * DevicePopup — TailAdmin right slide-over drawer (Phase 5).
 *
 * The control center for one vehicle: status header + live dot, quick facts
 * (speed/heading/odometer/ignition/driver/address/age), recent events, and
 * quick actions. Never a page navigation. Backed by `useVehicleDetail`.
 *
 * Contract preserved from the MUI Drawer: the overlay wrapper keeps
 * `role="presentation"` (referenced by tests) and closes on backdrop press,
 * ESC, and the header X.
 */
export function DevicePopup({ vehicleId, onClose, onShowHistory }: DevicePopupProps) {
  const { t } = useTranslation();
  const { data, isLoading, isError, error, refetch } = useVehicleDetail(vehicleId);

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
              <Badge color="warning">{t(`map.states.${data.state}`)}</Badge>
              <Badge color="gray">{t(`map.presence.${data.presence ?? 'UNKNOWN'}`)}</Badge>
            </div>

            {/* ── Quick facts grid ── */}
            <div className="mb-4 grid grid-cols-2 gap-3">
              <Fact icon={Gauge} label={t('map.popup.speed')} value={`${data.speed} km/h`} />
              <Fact icon={Navigation} label={t('map.popup.heading')} value={`${data.heading}°`} />
              <Fact
                icon={Power}
                label={t('map.popup.ignition')}
                value={data.ignitionOn ? t('map.popup.ignitionOn') : t('map.popup.ignitionOff')}
              />
              <Fact icon={Gauge} label={t('map.popup.odometer')} value={fmtKm(data.odometer)} />
              <Fact
                icon={User}
                label={t('map.popup.driver')}
                value={data.driver ?? t('map.popup.unassigned')}
              />
              {/* §19 Last seen — from the backend status record; "never" when absent. */}
              <Fact
                icon={History}
                label={t('map.lastSeen.label')}
                value={lastSeenLabel(data.lastSeenAt, t)}
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
                      ? t('map.popup.addressUnavailable')
                      : (reverse.data?.formatted ?? t('map.popup.addressUnavailable'))
              }
              fullWidth
            />

            {/* ── Quick actions ── */}
            <p className="mt-4 mb-2 text-sm font-semibold text-gray-800 dark:text-white">
              {t('map.popup.actions')}
            </p>
            <div className="mb-4 flex flex-wrap gap-1.5">
              <ActionButton icon={Navigation} label={t('map.popup.follow')} primary />
              <ActionButton icon={Video} label={t('map.popup.liveVideo')} />
              <ActionButton icon={History} label={t('map.popup.tripTimeline')} />
              <ActionButton icon={Send} label={t('map.popup.sendMessage')} />
              <ActionButton icon={History} label={t('map.popup.history')} onClick={onShowHistory} />
            </div>

            <div className="my-2 border-t border-gray-200 dark:border-white/5" />

            {/* ── Recent events ── */}
            <p className="mt-2 mb-2 text-sm font-semibold text-gray-800 dark:text-white">
              {t('map.popup.recentEvents')}
            </p>
            {data.events.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-graydark-600">
                {t('map.popup.noEvents')}
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {data.events.map((e) => (
                  <div key={e.id} className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: SEVERITY_COLOR[e.severity] }}
                    />
                    <p className="min-w-0 flex-1 text-sm text-gray-800 dark:text-graydark-800">
                      {t(`dashboard.alerts.${e.type}`)}
                      <span className="text-xs text-gray-500 dark:text-graydark-600">
                        {' · '}
                        {e.detail}
                      </span>
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

/** Compact key/value fact with an icon. */
function Fact({
  icon: Icon,
  label,
  value,
  fullWidth,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  fullWidth?: boolean;
}) {
  return (
    <div className={`flex min-w-0 items-center gap-2 ${fullWidth ? 'col-span-2' : ''}`}>
      <Icon size={15} aria-hidden className="shrink-0 text-gray-400 dark:text-graydark-600" />
      <div className="min-w-0">
        <p className="text-xs text-gray-500 dark:text-graydark-600">{label}</p>
        <p className="truncate text-sm font-medium tabular-nums text-gray-800 dark:text-graydark-800">
          {value}
        </p>
      </div>
    </div>
  );
}

/** Presentational quick-action button (§2.5 — wired actions call back; the rest stay deferred). */
function ActionButton({
  icon: Icon,
  label,
  primary,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  primary?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
        primary
          ? 'border-brand-500 bg-brand-500 text-white hover:bg-brand-600'
          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-transparent dark:text-graydark-700 dark:hover:bg-white/5'
      }`}
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
