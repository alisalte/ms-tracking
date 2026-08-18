# FleetVision TailAdmin Migration — Phase 5: Live Tracking Experience

**Date:** 2026-08-18
**Scope:** `apps/web-dashboard` live tracking (`/map`)
**Result:** 249/249 unit tests · typecheck ✅ · lint (all touched files) ✅ · production build ✅. Zero changes to FleetMap internals, GPS hooks, WebSocket layer, or APIs.

---

## 1. Architecture (unchanged data plane, new presentation plane)

```
TailAdmin UI (ported: DeviceListPanel · MapToolbar · PlaybackControls · DevicePopup · MapPage chrome)
  → Tracking feature (MapPage state: selection, filters, mode, playback wiring — logic unchanged)
    → Existing abstractions (useMapVehicles · useLiveTracking WS · useVehicleTrack · useTrackPlayback
                            · useVehicleDetail · useReverseGeocode · supercluster · splitTrackIntoSegments)
      → GPS engine / fleet-management / map-engine (REST + WS :3001)   [UNTOUCHED]
```

No parallel backend, no frontend GPS reprocessing. The full-bleed layout contract (`absolute inset-0` over the padded `<main>`) is preserved.

## 2. What was ported

| Component | Change | Contracts preserved |
|---|---|---|
| `DeviceListPanel` | MUI → Tailwind: search input, **native** `<select>` fleet filter, presence chips (real buttons), roster rows (presence dot + label + last-seen + speed), legend | search placeholder + aria-label; chip names `Online · N`; `{{shown}} of {{total}}` caption; `data-vehicle-id`; scroll-into-view; `map.noResults` |
| `MapToolbar` | MUI → Tailwind glass strip; mode toggle, custom-range datetime inputs, map-matching button, fleet count, route/pause buttons (tailwind-ui Button/IconButton/Tooltip) | aria-labels (`Live mode`, `History mode`, `Route planner`, pause/resume); `history-load` testid; `{{shown}} of {{total}} vehicles`; **history-preset stays an MUI `<Select>`** (e2e opens it with a real click and picks `role="option"` — a gesture native selects don't support) |
| `PlaybackControls` | MUI → Tailwind transport: buttons, native `<input type=range>` timeline, segmented speed buttons | every `playback-*` testid, aria-labels, `aria-live` current timestamp, `{s}×` button names (e2e) |
| `DevicePopup` | MUI Drawer → Tailwind slide-over: overlay wrapper keeps **`role="presentation"`**, backdrop + ESC close, facts grid, quick actions, events list | close does NOT clear selection (§31 inspector semantics); reverse-geocode flow; error/skeleton states |
| `MapPage` | chrome → Tailwind: Spinner loading, ErrorState, EmptyState, floating status pills (history loading/error/points, matching-unavailable, WS state) | `map-matching-unavailable` testid; WS chip copy/tones; full-bleed layout; deep links `?vehicle&from&to` |
| `map.spec.tsx` | fleet-filter gesture updated: MUI `mouseDown→option` click → native `fireEvent.change` (selector moved with the component, per Phase-1 R4) | everything else untouched |

**Untouched:** `FleetMap` (clustering, markers, popups, gap-split tracks, playback head), `useTrackPlayback`, `RoutePlannerDialog` (MUI dialog — its test asserts MUI dialog inputs; stays for gradual migration), `types.ts`, all API/WS modules.

## 3. Performance notes

- **State partitioning preserved**: MapPage owns shared UI state; the map re-renders on `filtered`/`track`/`playbackHead` only, exactly as before — the port changed markup, not data flow.
- **Live deltas** still merge via `mergeLivePositions` (latest-wins per vehicle) — one WS message updates one vehicle's row/marker, not a refetch.
- No new re-renders introduced: roster rows are plain memo-friendly markup; no layout thrash (CSS class toggling instead of Emotion `sx` serialization).
- Playback remains rAF-driven in the hook; the transport renders from the same `UseTrackPlaybackResult`.

## 4. Tests

- **New `live-tracking-shell.spec.tsx` (4):** route gate renders map with `tracking.read` / 403 without; drawer opens on row select, **backdrop close keeps selection** (§31); ESC close.
- **Existing suites still green:** `map.spec` (8: rendering, list, presence/fleet/search filters, drawer, WS chip), `map-history` (8: history mode, track render, route planner, map-matching fallback), `sprint-i-playback` (9: playback engine), `live-tracking` (8: WS merge), `realtime-socket` (12: reconnect/backoff).
- **E2E compatibility:** all `playback-*`, `history-*`, `map-matching-*` testids and button names preserved; the only e2e-relevant MUI surface left is the history-preset Select (kept deliberately).

**Suite: 249/249** (245 from Phase 4 + 4 new).

## 5. Known limitations

1. **History-preset select is still MUI** (e2e click-to-open gesture); native port needs a custom listbox — deferred with the overlay-primitives work.
2. **RoutePlannerDialog stays MUI** (dialog-input-index test contract).
3. The vehicle details drawer shows the fields the backend exposes (`useVehicleDetail`) — odometer renders "—" when unreported (never fabricated); driver stays "Unassigned" until the registry carries driver bindings.
4. No focus trap in the popup slide-over yet (same Phase-2 Modal limitation); ESC/backdrop close implemented.

**STOP after Phase 5.**
