# FleetVision TailAdmin Migration — Phase 7: Live Video, Cameras & Playback

**Date:** 2026-08-18
**Scope:** `apps/web-dashboard` video hub (`/video`)
**Result:** 262/262 unit tests · typecheck ✅ · lint ✅ (all touched files) · production build ✅. Backend video architecture untouched; stream engines (`LiveVideoPlayer`, `useStreamSession`, `useWallRotation`) untouched.

---

## 1. Architecture (data plane unchanged, presentation ported)

```
TailAdmin video hub (/video)
├─ WALL      WallToolbar + ChannelDock + WallGrid + VideoTile   [ported chrome]
│             └─ useStreamSession (synthetic canvas streams, honest 'stub' kind)
│                → media-service POST /streams (real backend swap path documented)
├─ CAMERAS   CamerasPanel — GET /channels (REAL media-service catalog)
└─ PLAYBACK  PlaybackPanel — honest shell (no recording endpoint exists yet)
```

**Backend reality respected:** media-service exposes `POST /streams`, `POST /streams/batch`, `DELETE /streams/:id`, `GET /channels`, `GET /channels/:id`, `POST /channels`, `GET /vehicles/:id/channels` — **no recording/playback endpoint**. Nothing was redesigned; no fake streams are ever rendered.

## 2. What was delivered

### Live video (Wall view)
All MUI chrome ported to TailAdmin: **WallToolbar** (6 division presets 1/4/9/16/36/64 as a segmented fieldset, live-cap indicator, spotlight / rotation / fullscreen / simulate-alert buttons, saved-wall loader), **ChannelDock** (camera + vehicle grouping with collapsible groups, search, online-only filter, auto-fill), **WallGrid** (square CSS grid + spotlight layout), **VideoTile** (states: empty, offline/no-consent, connecting spinner, live with latency + honest DEMO/OFFLINE stream-kind badge + REC + signal dot, queued-overflow with click-to-promote; control bar = real buttons with aria-labels; quality menu → tailwind-ui Dropdown). Single-camera view = division 1 / spotlight.

### Cameras (new tab)
Management table over the real channel catalog: camera (label + cabin-cam badge), channel id, vehicle/site, status (online/offline/no-consent/REC), **stream availability** (online ∧ consent), and "Add to wall" (disabled when unavailable). Search + online-only filter; honest empty state.

### Playback (new tab — honest shell)
Channel select + from/to datetime pickers + Load; **timeline scrubber + play/pause/stop/rewind transport** with live playback state (playing badge, current/end timestamps, window size). The video area renders an explicit **"playback backend pending"** notice and a per-window "no recording available" state — never simulated footage (same honesty contract as `useSaveWall`). When `GET /channels/:id/recordings` ships, only the loader changes. Transport timer is interval-driven (stack-safe, cleans up on unmount/stop).

### UX
Fullscreen (per-tile + whole-wall `f` shortcut), division shortcuts `1..6` (wall view, ignored while typing), fully keyboard-focusable controls with aria-labels/pressed states, dark mode throughout, responsive dock/table.

### Performance
Stream lifecycle contract preserved and documented: **queued/non-live tiles pass `null` to `useStreamSession`, tearing streams down** — no background streams; the wall's cap+rotate scheduler (`useWallRotation`, MAX_LIVE_TILES) still bounds concurrent streams; the playback timer self-cleans.

### Security
Channel gating is the existing INV-MED02 privacy model (offline/no-consent channels are visibly disabled and unassignable). No new permission surface was invented (the catalog defines no video permission strings — Phase-1 R9); tenant isolation unchanged (same API tenant header).

## 3. Changed files

**Ported (5):** `WallToolbar`, `ChannelDock`, `VideoTile`, `WallGrid`, `VideoWallPage` (now the tabbed hub with URL-synced `?view=&d=&spotlight=` + keyboard shortcuts).
**New (2):** `CamerasPanel.tsx`, `PlaybackPanel.tsx`.
**Untouched engines:** `LiveVideoPlayer`, `useStreamSession`, `useWallRotation`, `api/video.api.ts`, `lib/video-stream.ts`.
**i18n:** `video.tabs.*`, `video.cameras.*`, `video.playback.*`, `video.toolbar.divisions`, `video.keyboardHint` (en+fa).
**Tests:** `video-wall.spec` — 1 assertion updated (dock "Cameras" label now shared with the tab), +4 new tests.

## 4. Tests (262/262; +4 this phase)

| Area | Assertions |
|---|---|
| Wall (existing 8) | title + 6 divisions, dock from mock data, empty state, auto-fill, 16-division fill, live-cap indicator, snapshot control on a live tile, mock channel coverage |
| Cameras (new) | tab switch renders channel rows with availability badges + "Add to wall" buttons |
| Playback (new ×3) | honest pending-backend notice + disabled transport; channel+window load enables the transport, play→pause toggles state, stop resets/disables; video area stays in the honest no-recording state (never a fake stream) |

## 5. Known limitations

1. **Playback renders no video** — media-service has no recording endpoint. The shell is complete; wiring lands with the backend.
2. **Saved walls remain mock-only** (`useSaveWall` rejects honestly in real mode) — unchanged pre-existing behavior.
3. Stream sessions remain the documented synthetic-canvas pipeline (`streamKind: 'stub'` honestly badged DEMO) until WebRTC signaling lands.
4. `1..6` division shortcuts map to the six presets positionally, not to their numeric values (documented in the hint line).

**STOP after Phase 7.**
