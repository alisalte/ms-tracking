/**
 * NotificationBell — the TailAdmin notification dropdown in the header
 * (Phase 6 port of the MUI Popover bell).
 *
 * Renders a bell icon with a live unread-count badge. Clicking opens a
 * dropdown with the latest notifications, each with a mark-as-read action,
 * plus "mark all as read" and "view all". Real-time updates arrive via the WS
 * hook (shared query cache with the Notification Center).
 */
import { Bell, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
  useMarkAllAsRead,
  useMarkAsRead,
  useNotifications,
  useUnreadCount,
} from '@/api/notification.api';
import { Button, Spinner } from '@/components/tailwind-ui';
import { useNotificationRealtime } from '@/hooks/useNotificationRealtime';
import { localizeNotificationBody, localizeNotificationTitle } from '@/lib/alarm-copy';

export function NotificationBell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // Realtime: new notifications arrive over WebSocket and update the caches
  // incrementally; the 30s unread-count polling stays as a fallback.
  useNotificationRealtime();

  const { data: count } = useUnreadCount();
  const { data: notifications, isLoading } = useNotifications();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();

  const unread = count?.total ?? 0;
  const items = notifications ?? [];

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t('notifications.title')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-graydark-600 dark:hover:bg-white/5 dark:hover:text-white"
      >
        <Bell size={19} aria-hidden />
        {unread > 0 && (
          <span
            data-testid="bell-unread-count"
            className="absolute -top-0.5 -end-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-500 px-1 text-[0.65rem] font-bold text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Outside-press closes */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute end-0 z-50 mt-1.5 w-90 max-w-[92vw] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-white/10 dark:bg-graydark-300">
            <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
              <p className="text-sm font-bold text-gray-800 dark:text-white">
                {t('notifications.title', { defaultValue: 'Notifications' })}
                {unread > 0 && <span className="ms-1.5 text-xs text-danger-500">({unread})</span>}
              </p>
              {unread > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<CheckCheck size={14} />}
                  onClick={() => markAllAsRead.mutate()}
                  disabled={markAllAsRead.isPending}
                >
                  {t('notifications.markAllRead', { defaultValue: 'Mark all read' })}
                </Button>
              )}
            </div>

            {isLoading ? (
              <div className="flex justify-center py-8">
                <Spinner size="sm" label={t('common.loading')} />
              </div>
            ) : items.length === 0 ? (
              <p className="px-3.5 py-6 text-center text-sm text-gray-500 dark:text-graydark-600">
                {t('notifications.empty', { defaultValue: 'No notifications' })}
              </p>
            ) : (
              <ul className="fv-scroll m-0 max-h-90 list-none overflow-y-auto p-0">
                {items.slice(0, 10).map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!n.read) markAsRead.mutate(n.id);
                        setOpen(false);
                        if (n.link) navigate(n.link);
                      }}
                      className={`flex w-full cursor-pointer flex-col gap-0.5 border-none px-3.5 py-2.5 text-start transition-colors hover:bg-gray-50 dark:hover:bg-white/5 ${
                        n.read ? 'bg-transparent' : 'bg-gray-50 dark:bg-white/5'
                      }`}
                    >
                      <span className="flex w-full items-center gap-1.5">
                        {!n.read && (
                          <span
                            aria-hidden
                            className={`size-1.5 shrink-0 rounded-full ${
                              n.severity === 'critical' ? 'bg-danger-500' : 'bg-brand-500'
                            }`}
                          />
                        )}
                        <span
                          className={`min-w-0 flex-1 truncate text-sm ${
                            n.read
                              ? 'font-normal text-gray-700 dark:text-graydark-700'
                              : 'font-semibold text-gray-900 dark:text-white'
                          }`}
                        >
                          {localizeNotificationTitle(t, n)}
                        </span>
                      </span>
                      <span className="w-full truncate text-xs text-gray-500 dark:text-graydark-600">
                        {localizeNotificationBody(t, n)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-gray-200 p-2 dark:border-white/5">
              <Button
                fullWidth
                variant="secondary"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  navigate('/notifications');
                }}
              >
                {t('notifications.viewAll', { defaultValue: 'View all notifications' })}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
