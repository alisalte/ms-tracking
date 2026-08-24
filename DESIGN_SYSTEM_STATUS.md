# Design System Status — FleetVision Web Dashboard

> **Date:** 2026-08-24 · `apps/web-dashboard/src/components/tailwind-ui` is the single presentation layer.
> **Zero MUI / Emotion / stylis** — verified: `grep -R "@mui" apps/web-dashboard/src` returns nothing; 8 packages removed from `package.json` + lockfile.

---

## 1. Inventory (28 exported primitives + 2 shared constants)

| Primitive | States covered | Notes |
|---|---|---|
| `Button` | 6 variants × 3 sizes, loading, disabled, focus-visible | TailAdmin shadow/outline idioms |
| `IconButton` | ghost/solid/outline, danger tint, focus ring | |
| `Input` | label/hint/error, `leftIcon`, **`endAdornment` (new)** | RHF-ready forwardRef |
| `Textarea`, `Select`, `Checkbox`, `Switch` | label wiring, aria-invalid/describedby, disabled | `CHECKBOX_INPUT_CLASS` exported (new) for table cells |
| `ListboxSelect` / `MultiSelect` | WAI-ARIA combobox+listbox, keyboard, **`tone="onGlass"` (new)** | used by map glass panels |
| `SegmentedControl` **(NEW)** | radiogroup a11y, arrows/Home/End, disabled, onGlass | replaced 6 hand-rolled copies |
| `DataTable` | sort, sticky header, skeleton, empty, **errorState, selection+bulk bar, column hidden, row focus-visible (new)** | the one table pattern |
| `Table/THead/…` | composable atoms | |
| `Card` / `CardHeader` | padding scale, interactive lift, flush | |
| `PageHeader` | title/description/actions + **eyebrow, divider (new)** | every page |
| `Drawer` | sizes, Esc, backdrop, scroll-lock, closeOnBackdrop | AlarmDetailDrawer + asset dirty-guard on it |
| `Modal` | sizes, footer, closeOnBackdrop | |
| `Tabs` | aria-controls, **`TabItem.testid` (new)** | ReportsPage |
| `Toolbar` | built-in accessible search + left/right slots | filter bars |
| `Badge` / `StatusBadge` | semantic colors, dot | single severity/status token system |
| `Avatar` | initials fallback, sizes | |
| `Alert` | 4 variants, role=alert/status | |
| `Tooltip` | 4 sides | |
| `Meter` **(NEW)** | tones, value/max readout, focusable progressbar | merged 2 copies |
| `EmptyState`, `Skeleton`, `Spinner` | icon/title/description; shapes; labels | loading language = skeletons (spinners only in-place) |
| `NumberedPagination` / `LoadMoreButton` | | |

**Composed (documented, gallery-exhibited):** `KpiTile`+`KpiChip` (dashboard), `DashboardCard` (state triad), `EChart` (theme-aware base; charts stay LTR by convention), `ErrorState` (common; 401/403/network classification).

## 2. Tokens (`src/styles/tailwind.css` `@theme`)

Brand indigo 25–900 (`#465ffb` primary) · TailAdmin gray + graydark ramps · semantic success/warning/danger/info 50–700 · meta chart accents 1–9 · fonts Roboto/Vazirmatn/JetBrains Mono. Class-based dark mode (`.dark` on html via ThemeRegistry). RTL via logical utilities only (grep-verified: no physical `ml-/mr-/pl-/pr-` in app code). Chart/map hexes live ONLY in `theme/palette.ts` (+ new `dangerDeep`).

## 3. Governance rules (enforced by this redesign + reviewable in the gallery)

1. Pages import presentation components from `@/components/tailwind-ui` only — no page-local buttons/cards/badges/filter bars (all hand-rolled copies retired this pass).
2. Raw hex colors only inside `palette.ts`/`tailwind.css`.
3. Every data surface ships the triad: skeleton loading → error (ErrorState + retry) → empty (EmptyState). Failures are never rendered as zeros/empties.
4. Destructive/irreversible mutations confirm (ConfirmDialog) and toast on success/failure.
5. Relative time only via `lib/relative-time` (i18n-aware; 4 implementations → 1).
6. New pattern? Add it to `tailwind-ui` + the gallery, then consume.

## 4. Verification snapshot (2026-08-24)

`tsc -b --noEmit` ✅ · `vitest` 31 files / **276 tests** ✅ · `biome check` all 79 touched files ✅ (pre-existing legacy-file errors unchanged) · `vite build` ✅ · i18n parity **en=fa=1220** ✅ · MUI grep **0** ✅.

## 5. Known limitations (honest list)

- `Drawer`/`Modal` have no focus trap (documented in-code) — the top a11y follow-up.
- `DataTable` has no column-visibility UI (the `hidden` prop is the seam); no virtualization (rosters are small).
- `maxHeight calc(100vh - Npx)` table heights vary per page — a shared density token was deferred.
- Gallery lives at a public dev route `/dev/ui-gallery` (unlinked) — acceptable for a dev tool; gate behind a build flag if desired.
