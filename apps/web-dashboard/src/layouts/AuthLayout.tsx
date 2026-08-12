import { Activity, Camera, MapPin, ShieldCheck, Truck } from 'lucide-react';
import { Outlet } from 'react-router';

/**
 * AuthLayout — branded split-panel shell for unauthenticated pages.
 *
 * TailAdmin-inspired: a deep-indigo brand panel (feature pills + headline)
 * beside a centered form panel. On mobile it collapses to a centered card.
 * RTL-safe (logical spacing + direction-aware glow anchors). The form content
 * (login/register/etc.) renders via `<Outlet />` — those pages remain on MUI
 * this pass; they read fine under the indigo-tinted tokens.
 */
const FEATURES = [
  { icon: Truck, label: 'Fleet Tracking' },
  { icon: MapPin, label: 'Live Map' },
  { icon: Camera, label: 'Video Wall' },
  { icon: Activity, label: 'Real-time Alerts' },
];

export function AuthLayout() {
  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-graydark-200">
      {/* ── Branded panel (desktop only) ── */}
      <div
        className="relative hidden flex-1 flex-col justify-center overflow-hidden p-16 md:flex"
        style={{
          background: 'linear-gradient(160deg, #1B1E6E 0%, #2D31D4 45%, #465FFB 100%)',
        }}
      >
        {/* Decorative radial glows */}
        <div
          className="pointer-events-none absolute -top-[12%] -end-[8%] size-[420px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(99,102,241,0.35) 0%, transparent 70%)',
          }}
        />
        <div
          className="pointer-events-none absolute -bottom-[12%] -start-[8%] size-[360px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(139,92,246,0.28) 0%, transparent 70%)',
          }}
        />

        <div className="relative z-10 flex max-w-md flex-col gap-8">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div
              className="flex size-11 items-center justify-center rounded-xl shadow-lg"
              style={{ background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)' }}
            >
              <ShieldCheck size={24} color="#fff" />
            </div>
            <span className="text-2xl font-bold text-white">FleetVision</span>
          </div>

          {/* Headline */}
          <div>
            <h1 className="mb-2 text-[1.75rem] font-bold leading-tight text-white">
              Enterprise Fleet Intelligence
            </h1>
            <p className="text-[0.95rem] leading-relaxed text-white/70">
              Real-time tracking, video telematics, maintenance, and compliance — unified in one
              calm, fast, secure dashboard.
            </p>
          </div>

          {/* Feature pills */}
          <div className="mt-2 flex flex-wrap gap-2.5">
            {FEATURES.map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5"
              >
                <Icon size={15} className="text-brand-200" />
                <span className="text-xs font-medium text-white/90">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Form panel ── */}
      <div className="flex flex-1 items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-[420px]" style={{ animation: 'fv-fade-in 0.4s ease' }}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
