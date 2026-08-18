import { Outlet } from 'react-router';

/** Standard content-area padding exposed for full-bleed pages (px). */
export const PAGE_PADDING = 20;

/**
 * MainContent — the TailAdmin scrollable content region (Tailwind).
 *
 * The active route renders inside via the layout `<Outlet/>`. Contracts kept
 * from the previous shell:
 * - `id="fv-main-content"` — a11y skip target.
 * - `position: relative` — full-bleed pages (Map, Video Wall) render
 *   `position:absolute; inset:0` and cover exactly this area.
 * - `PAGE_PADDING` inner padding (overridable per-page later via layout
 *   variants).
 */
export function MainContent() {
  return (
    <main
      id="fv-main-content"
      className="relative min-h-0 flex-1 overflow-auto bg-gray-50 dark:bg-graydark-200"
      style={{ padding: PAGE_PADDING }}
    >
      <Outlet />
    </main>
  );
}
