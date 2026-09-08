# Alarm Center timeline / map tabs feel broken

## Summary

On `/alarms`, the Timeline and Map view tabs appeared not to work: filters
stretched full-width, the RTL detail drawer covered the view switcher, and Map
showed Tehran with pins that were easy to miss.

## Status

Fixed in source (needs `pnpm build:web` + docker copy to verify live).

## Root causes

1. **Select `w-full` vs `wrapperClassName="w-40"`** — both utilities on the same
   node; Tailwind v4 let `w-full` win, so Alarm Center filters stacked and
   pushed the view switcher into a cramped strip.
2. **RTL drawer overlap** — the detail drawer slides from the inline-end (left
   in Persian). The view tabs lived in Toolbar `right`, which is also on the
   left in RTL, so the panel covered Timeline/Map and ate their clicks.
3. **Blocking Drawer backdrop** — even without overlap, a capturing dimmer
   closed the drawer instead of switching views.
4. **AlarmMap** — tiny 20px dots, no `fitBounds` / `resize`, so the map often
   looked empty relative to the busy basemap.

## Fix

- Select: apply `w-full` only when `wrapperClassName` is omitted.
- Drawer: `backdrop="visual" | "blocking" | "none"`; Alarm detail uses `visual`.
- Alarm Center: move view tabs to Toolbar `left` (inline-start / right in RTL);
  functional `setParams`; switching view clears `id` (keeps `focus` for fly-to).
- AlarmMap: pin markers, ResizeObserver + `resize()`, fitBounds on first pins.
- Timeline: empty state when no hour bucket has items (invalid `raisedAt`).
