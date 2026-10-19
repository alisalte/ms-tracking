import { Outlet } from 'react-router';

/** Standard content-area padding exposed for full-bleed pages (px, ≥ sm). */
export const PAGE_PADDING = 20;

/**
 * MainContent — the TailAdmin scrollable content region (Tailwind).
 *
 * The active route renders inside via the layout `<Outlet/>`. Contracts kept
 * from the previous shell:
 * - `id="fv-main-content"` — a11y skip target.
 * - `position: relative` — full-bleed pages (Map, Video Wall) render
 *   `position:absolute; inset:0` and cover exactly this area.
 * - `PAGE_PADDING` inner padding on ≥ sm; phones get a tighter 12px so cards
 *   keep their width.
 */
export function MainContent() {
  return (
    <main
      id="fv-main-content"
      className="relative min-h-0 flex-1 overflow-auto overscroll-contain bg-transparent p-3 sm:p-5"
    >
      <Outlet />
    </main>
  );
}
