import { Activity, Camera, MapPin, Truck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';

import { Brand } from '@/components/branding/Brand';

/**
 * AuthLayout — TailAdmin split-panel shell for unauthenticated pages.
 *
 * Left: branded dark panel (brand gradient, headline, feature pills) — hidden
 * below `md`. Right: centered form column (max 420px) hosting the public auth
 * routes. RTL-safe via logical utilities. The form pages themselves (register,
 * forgot/reset, MFA) still use MUI internally during the gradual migration —
 * they render unchanged inside this Tailwind chrome.
 */
export function AuthLayout() {
  const { t } = useTranslation();

  const features = [
    { icon: Truck, key: 'fleet' },
    { icon: MapPin, key: 'map' },
    { icon: Camera, key: 'video' },
    { icon: Activity, key: 'alerts' },
  ] as const;

  return (
    <div className="flex min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(70,95,251,0.11),transparent_34%),linear-gradient(180deg,#f8fbff_0%,#eef2f7_100%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(70,95,251,0.18),transparent_32%),linear-gradient(180deg,#101722_0%,#161e29_100%)]">
      {/* ── Branded panel (desktop) ── */}
      <div className="relative hidden flex-1 items-center overflow-hidden bg-[linear-gradient(135deg,#0f1722_0%,#172338_52%,#1b1e6e_100%)] p-10 shadow-2xl shadow-gray-950/20 md:flex lg:p-14">
        {/* Decorative glows */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-[12%] -end-[8%] size-[420px] rounded-full bg-[radial-gradient(circle,rgba(70,95,251,0.22)_0%,transparent_70%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-[12%] -start-[8%] size-[360px] rounded-full bg-[radial-gradient(circle,rgba(129,153,253,0.18)_0%,transparent_70%)]"
        />

        <div className="relative z-10 max-w-md">
          <Brand size="lg" className="mb-8" />

          <h1 className="text-3xl leading-tight font-bold text-white">
            {t('auth.brandHeadline', 'Enterprise Fleet Intelligence')}
          </h1>
          <p className="mt-3 text-[0.95rem] leading-7 text-white/70">
            {t(
              'auth.brandSubline',
              'Real-time tracking, video telematics, maintenance, and compliance — unified in one calm, fast, secure dashboard.',
            )}
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {features.map(({ icon: Icon, key }) => (
              <span
                key={key}
                className="inline-flex items-center gap-2 rounded-full border border-brand-400/30 bg-brand-500/15 px-3 py-1.5 text-xs font-medium text-gray-100"
              >
                <Icon size={14} className="text-brand-300" aria-hidden />
                {t(`auth.brandPill.${key}`)}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Form panel ── */}
      <div className="flex flex-1 items-center justify-center p-4 sm:p-8">
        <div className="fv-surface w-full max-w-[460px] animate-[fv-fade-in_0.4s_ease] rounded-3xl border p-5 shadow-2xl sm:p-7">
          {/* Mobile brand (panel hidden below md) */}
          <div className="mb-6 flex justify-center md:hidden">
            <Brand size="md" onDark={false} />
          </div>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
