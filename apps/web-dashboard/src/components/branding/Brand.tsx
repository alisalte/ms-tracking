import { Truck } from 'lucide-react';

/**
 * FleetVision brand — the single source for the logo + wordmark.
 *
 * Every surface that shows the brand (app sidebar, auth split-panel, future
 * surfaces) composes these two components instead of hardcoding the mark.
 * The mark is the TailAdmin indigo gradient with a truck glyph; the wordmark
 * is always "FleetVision" in the bold sans stack.
 */

export type BrandSize = 'sm' | 'md' | 'lg';

const TILE: Record<BrandSize, string> = {
  sm: 'size-8 rounded-lg [&_svg]:size-[18px]',
  md: 'size-10 rounded-lg [&_svg]:size-5',
  lg: 'size-11 rounded-xl [&_svg]:size-6',
};

const WORDMARK: Record<BrandSize, string> = {
  sm: 'text-base',
  md: 'text-lg',
  lg: 'text-2xl',
};

/**
 * BrandLogo — the gradient icon tile, usable standalone (collapsed sidebar,
 * favicon-adjacent chrome).
 */
export function BrandLogo({
  size = 'md',
  className = '',
}: { size?: BrandSize; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center bg-gradient-to-br from-brand-500 to-brand-800 text-white shadow-lg shadow-brand-500/25 ${TILE[size]} ${className}`}
    >
      <Truck strokeWidth={2.2} />
    </span>
  );
}

/**
 * Brand — logo tile + "FleetVision" wordmark.
 *
 * `onDark` controls the wordmark color: the mark usually sits on dark surfaces
 * (sidebar, auth panel); on light surfaces pass `onDark={false}`.
 */
export function Brand({
  size = 'md',
  onDark = true,
  showWordmark = true,
  className = '',
}: {
  size?: BrandSize;
  onDark?: boolean;
  showWordmark?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <BrandLogo size={size} />
      {showWordmark && (
        <span
          className={`font-sans font-bold tracking-tight whitespace-nowrap ${WORDMARK[size]} ${
            onDark ? 'text-white' : 'text-gray-900 dark:text-white'
          }`}
        >
          FleetVision
        </span>
      )}
    </span>
  );
}
