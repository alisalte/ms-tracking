import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import welcomeTruck from '@/assets/dashboard/welcome-truck.png';
import { useAuth } from '@/hooks/useAuth';
import { headingFromEmail } from '@/lib/display-name';
import { formatDate, formatTime } from '@/lib/format-date';
import { LiveBadge } from './LiveBadge';

/**
 * WelcomeBanner — dashboard hero (greeting + fleet photo + live clock).
 *
 * Identity comes from the signed-in user; the clock is local and locale-aware
 * (Jalali when the UI language is Persian).
 */
export function WelcomeBanner() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const name = headingFromEmail(user?.email || t('common.profile'));
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const clock = (
    <div className="w-fit shrink-0 rounded-xl border border-white/80 bg-white/92 px-4 py-3 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-graydark-200/90">
      <p className="text-[11px] font-semibold tracking-wide text-gray-400 uppercase dark:text-graydark-600">
        {t('dashboard.todayLabel')}
      </p>
      <p className="mt-0.5 text-sm font-bold tabular-nums text-gray-800 dark:text-white">
        {formatDate(
          now,
          { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
          i18n.language,
        )}
      </p>
      <p className="text-xs tabular-nums text-gray-500 dark:text-graydark-600">
        {formatTime(now, undefined, i18n.language)}
      </p>
    </div>
  );

  return (
    <section className="relative overflow-hidden rounded-2xl border border-brand-200/80 bg-gradient-to-l from-brand-50 via-white to-info-50 dark:border-white/10 dark:from-brand-500/15 dark:via-graydark-300 dark:to-info-500/10">
      <div className="grid min-h-[176px] grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.95fr)]">
        <div className="relative z-10 flex flex-col justify-center gap-4 px-5 py-5 sm:px-7 sm:py-6">
          <div className="min-w-0 max-w-2xl">
            <h1 className="text-[1.35rem] font-bold tracking-tight text-gray-900 sm:text-[1.6rem] dark:text-white">
              {t('dashboard.welcomeNamed', { name })}
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-graydark-600">
              {t('dashboard.subtitle')}
            </p>
            <p className="sr-only">{t('dashboard.title')}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <LiveBadge />
              <Link
                to="/map"
                className="inline-flex h-9 items-center justify-center rounded-xl px-3.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-200 transition-colors hover:bg-brand-50 dark:text-brand-300 dark:ring-brand-400/40 dark:hover:bg-brand-500/10"
              >
                {t('dashboard.widgets.openMap')}
              </Link>
            </div>
          </div>
          <div className="lg:hidden">{clock}</div>
        </div>

        <div className="relative h-44 overflow-hidden sm:h-52 lg:h-auto lg:min-h-full">
          <img
            src={welcomeTruck}
            alt={t('dashboard.bannerPhotoAlt')}
            className="absolute inset-0 h-full w-full object-cover object-[center_40%]"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent lg:bg-gradient-to-r lg:from-transparent lg:to-black/10 rtl:lg:bg-gradient-to-l"
          />
          <div className="absolute end-3 bottom-3 hidden lg:block">{clock}</div>
        </div>
      </div>
    </section>
  );
}
