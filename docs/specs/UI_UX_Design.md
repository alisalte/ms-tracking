# FleetVision — UI/UX Design

**Version:** 1.0.0
**Status:** Approved — Implementation Ready
**Date:** 2026-08-02
**Owner:** Lead Product Designer / Frontend Architect
**Classification:** Confidential — Design Reference

---

## Document Purpose

This document is the **canonical UI/UX reference** for FleetVision's user-facing surfaces. It translates the platform's product vision (`00_Project_Vision.md`) and module capabilities (`docs/modules/*.md`) into concrete screens, flows, and interaction patterns for the people who operate fleets every day.

The design serves five primary personas, each on their own surface:

| Persona | Primary Surface | Goal |
|---|---|---|
| **Dispatcher / Fleet Manager** | Fleet Dashboard, Map Dashboard | Operate the fleet in real time |
| **Fleet Manager / Safety Officer** | Video Dashboard, Maintenance Dashboard | Review evidence, plan maintenance |
| **Fleet / Tenant Admin** | Admin Panel | Configure users, fleets, policies, billing |
| **Driver** | Mobile App (React Native) | Complete trips, log HOS, stay compliant |
| **Executive** | Fleet Dashboard (read-only) | KPI overview, fleet health |

| Vision Pillar | Design Enabler (this document) |
|---|---|
| **Simplicity** (consumer-grade UX) | Design system (§0), consistent patterns, progressive disclosure |
| **Intelligence** (ML-driven) | Surfaces AI insights inline, not in a separate "AI tab" |
| **Trust** (compliance) | Tamper-evident timelines, audit trails, clear severity |
| **Openness** (integrations) | Standards-based API explorer in Admin Panel |

> **Scope note.** This document specifies *what* each surface contains and *how* it behaves (layouts, components, flows). It is paired with the live **Figma component library** (the visual source of truth) and the **Storybook** (component code examples). Where the two disagree, Figma wins for visual treatment; this document wins for layout/IA/flows.

---

## Table of Contents

0. [Design System Foundation](#0-design-system-foundation)
1. [Fleet Dashboard](#1-fleet-dashboard)
2. [Map Dashboard](#2-map-dashboard)
3. [Video Dashboard](#3-video-dashboard)
4. [Maintenance Dashboard](#4-maintenance-dashboard)
5. [Admin Panel](#5-admin-panel)
6. [Mobile App](#6-mobile-app)
7. [User Flow](#7-user-flow)
8. [Wireframe Description](#8-wireframe-description)

---

## 0. Design System Foundation

FleetVision's UI is built on a single **design system** — *FleetVision DS* — implemented as a React component library (`@fleetvision/ui`) consumed by the Web Dashboard, Admin Portal, and (via a parity layer) the React Native mobile app. Consistency across surfaces is not optional: a fleet manager who learns the web app must instantly recognize the same patterns on mobile.

### 0.1 Design Principles

| Principle | What it means in practice |
|---|---|
| **Calm by default, loud when it matters** | The screen is mostly neutral; color and motion are reserved for things that need attention (alerts, status changes). A green fleet is a quiet fleet. |
| **Progressive disclosure** | Show summary first, detail on demand. Never show a 50-field form; reveal fields contextually. |
| **Data is the hero** | Charts and maps take the screen chrome; controls recede. Tables are dense but legible. |
| **Reversible by default** | Destructive actions require confirmation; everything else is undoable for 10s (toast). |
| **Real-time is truth** | Live data has visual "freshness" cues (pulsing dot, age timestamp); stale data looks stale. |
| **Accessible to everyone** | WCAG 2.1 AA minimum; keyboard-first; color is never the only signal. |
| **Density modes** | "Comfortable" (default) and "Compact" (power dispatchers) — same data, more rows. |

### 0.2 Color System

Semantic, accessible (≥ 4.5:1 contrast on text). Neutral base + a single primary + status colors.

```
NEUTRAL SCALE (slate)
  0  #FFFFFF  background / cards
  50 #F8FAFC  subtle background, table stripes
 100 #F1F5F9  hover, dividers
 200 #E2E8F0  borders
 500 #64748B  secondary text, icons
 800 #1E293B  primary text
 900 #0F172A  headings, app chrome (dark mode base)

PRIMARY (brand — deep blue, "trust + technology")
 500 #2563EB  primary actions, links, focus ring
 600 #1D4ED8  primary hover
 700 #1E40AF  pressed

STATUS (semantic — consistent across all surfaces)
  GREEN  #16A34A  healthy / on-time / completed / active
  AMBER  #F59E0B  warning / approaching limit / stale (≤2× interval)
  RED    #DC2626  critical / violation / faulted / overdue
  BLUE   #2563EB  informational / in-progress / live
  PURPLE #9333EA  AI / ML insight (distinct from operational blue)
  SLATE  #64748B  neutral / unknown / off-duty

MAP ACCENTS (high-saturation for vehicle visibility on dark tiles)
  Vehicle-active     #22D3EE (cyan)
  Vehicle-idle       #FACC15 (yellow)
  Vehicle-overspeed  #FB7185 (rose)
  Vehicle-offline    #94A3B8 (slate)
  Geofence           #A78BFA (purple, translucent fill)
  Selected route     #34D399 (emerald)
```

**Dark mode** is first-class (dispatchers work 24/7 in dim NOCs). The map dashboard defaults to dark; others follow OS preference.

### 0.3 Typography

```
Family:   Inter (UI) + JetBrains Mono (data: VINs, coordinates, codes)
Scale:    11 / 12 / 13 / 14 (base) / 16 / 18 / 20 / 24 / 30 / 36
Weights:  400 body · 500 labels/medium · 600 headings · 700 page titles
Line ht:  1.2 headings · 1.5 body
Numeric:  tabular-nums on all tables/metrics (no jitter on live updates)
```

### 0.4 Spacing & Layout

8-point grid. Layout shell:

```
┌──────────────────────────────────────────────────────────────────┐
│ Top Bar (56px): logo · global search · alerts bell · user menu   │
├──────────┬───────────────────────────────────────────────────────┤
│          │                                                       │
│ Side     │   Main content (max-width fluid, 24px gutter)         │
│ Nav      │                                                       │
│ (240px,  │   Breadcrumbs · Page title · Actions                  │
│ collaps- │   ───────────────────────────────────────────        │
│ ible to  │                                                       │
│ 72px     │   [content]                                           │
│ icons)   │                                                       │
│          │                                                       │
└──────────┴───────────────────────────────────────────────────────┘
```

Breakpoints: `sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536`. Map/Video dashboards are full-bleed; others use a 12-col grid.

### 0.5 Component Library (Core)

| Component | Notes |
|---|---|
| `Button` (primary / secondary / ghost / danger / icon) | consistent radius 6px; loading state |
| `StatCard` | KPI tile: value, delta vs period, sparkline, drilldown |
| `DataTable` | virtualized (1M rows), sticky header, column show/hide, saved views, inline row actions, density toggle |
| `MapCanvas` | Mapbox GL wrapper: markers, clusters, geofences, routes, popups |
| `VideoTile` | WebRTC `<video>` + overlays (latency, recording, AI boxes) |
| `Timeline` | multi-track scrubber (video/events/AI — §3.5, GPSEngine §11) |
| `StatusPill` | colored chip with icon; one per domain status |
| `Drawer` | right-side detail panel (slide-over); never full-page for peek |
| `Modal` | max 560px; one primary action |
| `Toast` | bottom-right; undo action for 10s on destructive |
| `EmptyState` | illustration + CTA; never a blank page |
| `FilterBar` | saved filters, URL-state sync, shareable links |
| `CommandPalette` (`Cmd+K`) | power-user search/jump/action |
| `AlertsBell` | grouped notifications with severity filter |

### 0.6 Interaction Patterns

- **Selection → detail**: click a row/marker → right Drawer with detail (never navigate away). `Esc` or backdrop closes.
- **Bulk actions**: table multi-select reveals a bulk-action bar.
- **Optimistic updates**: writes update UI immediately; rollback + toast on failure.
- **Live indicators**: a pulsing 6px dot = fresh (< 10s); a static ring = recent; grey = stale.
- **Loading**: skeletons (not spinners) for initial; inline spinners for actions.
- **Empty/zero states**: always explain why and what to do next.
- **Keyboard**: every action has a shortcut; `?` shows the cheatsheet.

### 0.7 Iconography & Imagery

- **Icons**: Lucide (consistent 1.5px stroke, 20px default).
- **Status icons**: filled circle (●) colored by status; never rely on color alone — pair with icon/label.
- **Imagery**: real fleet photography in marketing/onboarding; no stock illustrations inside the product.

### 0.8 Accessibility (WCAG 2.1 AA)

- All interactive elements ≥ 44×44 px touch target (mobile).
- Color contrast ≥ 4.5:1 text, ≥ 3:1 UI components; tested in both themes.
- Full keyboard navigation; visible focus ring (2px primary).
- ARIA live regions for: live map updates, alert toasts, recording status.
- `prefers-reduced-motion` disables pulsing/animations.
- Screen-reader labels on all icon-only buttons; map markers expose vehicle label + status.

### 0.9 Internationalization

- i18n via `react-i18next`; strings externalized; no hardcoded copy.
- RTL support (Arabic/Hebrew) — layout flips; map controls mirror.
- Locale-aware: dates (`2026-08-02`), times (24h default, 12h opt), units (km/mi, L/gal, °C/°F), currency, first-day-of-week.
- Driver app localized to 12 launch languages.

---

## 1. Fleet Dashboard

The **home screen** for dispatchers and fleet managers — a real-time operational overview and the launchpad into every workflow.

### 1.1 Purpose & Audience

A dispatcher's first 30 seconds on this screen answer: *Is anything on fire? Who needs me now?* Then they drill into the map, a vehicle, or an alert. The dashboard is **scan-first, act-second**.

### 1.2 Information Architecture

```
Top Bar:  Fleet switcher ▾ · Global Search · Alerts bell · Help · User
Side Nav: Dashboard · Map · Vehicles · Drivers · Trips · Video · Maintenance ·
          Compliance · Fuel · Reports · (Video/Maintenance/etc.)
Main:     Operational overview
```

### 1.3 Layout — Wireframe

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ FleetVision  ▾ Acme Logistics         ⌕ Search…      🔔 7    ?    JD ▾        │
├───────────┬──────────────────────────────────────────────────────────────────┤
│ ⌂ Dashboard│ Acme Logistics  ·  Live overview  ·  ◉ Live (12s)   [Export ▾]   │
│ ◎ Map      │ ──────────────────────────────────────────────────────────────── │
│ ▦ Vehicles │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│ ▤ Drivers  │  │ Active  │ │ Driving │ │ Idle    │ │ Offline │ │ Alerts  │    │
│ ➤ Trips    │  │   312   │ │   184   │ │   41    │ │   87    │ │   7  ●  │    │
│ ▶ Video    │  │ ▲ +12   │ │  59%    │ │ ▲ +5    │ │         │ │ 2 CRIT  │    │
│ ⚙ Maintain │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘    │
│ ✓ Compliance│                                                                  │
│ ⛽ Fuel     │  ┌──────────────────────────────────┐ ┌────────────────────────┐│
│ 📊 Reports │  │ Fleet Activity (24h)              │ │ Active Alerts          ││
│            │  │   ╱╲    ╱╲╱╲      ╱╲              │ │ ● OVERSPEED  Truck-42  ││
│            │  │  ╱  ╲  ╱    ╲    ╱  ╲   driving   │ │   128 km/h · 14:31     ││
│            │  │ ╱    ╲╱      ╲__╱    ╲_ idle      │ │ ● IDLE 15m+  Van-07    ││
│            │  │                                  │ │ ● GEOFENCE  Truck-19   ││
│            │  │ 0    6    12    18    24         │ │   exited Depot-N       ││
│            │  └──────────────────────────────────┘ │ ● FCW  Truck-55         ││
│            │                                       │   [View all 7 →]        ││
│            │  ┌──────────────────────────────────┐ └────────────────────────┘│
│            │  │ Vehicles Needing Attention        │                          │
│            │  │ ⚠ Truck-42  Overspeed · 14:31     │ ┌────────────────────────┐│
│            │  │ ⚠ Van-07    Excess idle · 18m     │ │ Fleet Utilization      ││
│            │  │ ⚙ Truck-19  DTC P0420 · catalytic │ │     73%   ▮▮▮▮▮▮▮░░░  ││
│            │  │ ⚠ Truck-55  AI: forward collision │ │ Driving  59%           ││
│            │  │ 🔋 Bus-12    Low battery · 11%    │ │ Idle     13%           ││
│            │  │                       [View →]    │ │ Stopped  19%           ││
│            │  └──────────────────────────────────┘ │ Offline   9%           ││
│            │                                       └────────────────────────┘│
└───────────┴──────────────────────────────────────────────────────────────────┘
```

### 1.4 Components in Detail

- **Stat cards (top row)**: Active / Driving / Idle / Offline vehicles; Alerts. Each is a `StatCard` with delta vs yesterday and a sparkline. Clicking drills into the Map filtered to that status.
- **Fleet Activity chart**: 24h stacked area (driving / idle / stopped). Hover shows counts per hour. Legend doubles as filter.
- **Active Alerts panel**: live (WebSocket), severity-sorted, click → opens Map with that vehicle + Drawer with the alert + (if video) the event clip cued to the moment.
- **Vehicles Needing Attention**: ranked list blending maintenance (DTCs), behavior, AI, and device-health signals — the "what should I look at" list.
- **Fleet Utilization**: donut + bars showing time-in-state breakdown.

### 1.5 Behaviors

- All metrics **update live** (WebSocket) with the freshness dot.
- **Time-range selector** (Today / 7d / 30d) on the chart; "Live" badge only on Today.
- **Fleet switcher** (top bar) scopes the whole dashboard to a fleet/sub-fleet; URL persists the selection.
- **Export** produces a PDF/CSV of the current view.

### 1.6 Empty / Error States

- New tenant (no vehicles): friendly illustration + "Provision your first device" CTA → Admin Panel.
- WebSocket disconnected: banner "Live updates paused — showing last known (2m ago)" with retry.

---

## 2. Map Dashboard

The **real-time map** is the operational heart — where every vehicle is, right now, with everything layered on.

### 2.1 Purpose

Answer spatial questions instantly: *Where are my trucks? Who's nearest to a pickup? Who left the geofence? Where's the speeding vehicle?*

### 2.2 Layout — Wireframe

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ FleetVision  ▾ Acme       ⌕ Search vehicle/VIN/driver…     🔔  ?    JD ▾      │
├───────────┬──────────────────────────────────────────────────────────────────┤
│ Layers    │ ┌─ Filters ───────────────────────────────────────────────────┐  │
│ ▣ Vehicles│ │ Fleet: All ▾  Status: ●Active ○Idle ○Off  Driver: All ▾   🔎│  │
│ ▣ Geofences│ └─────────────────────────────────────────────────────────────┘  │
│ ▣ Routes   │ ┌──────────────────────────────────────────────────────────────┐│
│ ▣ Traffic  │ │                                                                  ││
│ ▣ AI heat  │ │                          ◗  Truck-42  128km/h ←                ││
│ ─────────  │ │        ◗ Truck-19                                          ││
│ Filters    │ │                   ◗ Van-03                                 ││
│ Fleet ▾    │ │      ╔═══════╗          ◗ Bus-12                           ││
│ Status ☑All│ │      ║Depot-N║                                             ││
│ ─────────  │ │      ╚═══════╝            ◗ Van-07 (idle)                  ││
│ ◉ Live (8s)│ │                            ◗ Truck-55                       ││
│            │ │                                                                  ││
│ [Video Wall│ │                                                                  ││
│  ▾]        │ │                                                                  ││
│            │ │                                                                  ││
│            │ └──────────────────────────────────────────────────────────────┘│
│            │  ┌─────────────── Clustering on · 312 vehicles · Zoom 8 ───────┐│
│            │  └──────────────────────────────────────────────────────────────┘│
└───────────┴─ Vehicle selected → Drawer (right slide-over) ─────────────────────┘
                                                          ┌─────────────────────┐
                                                          │ Truck-42  ▸ Live    │
                                                          │ ─────────────────── │
                                                          │ ● Driving 128 km/h  │
                                                          │ Driver: M. Chen     │
                                                          │ Trip: TR-4421 → DP  │
                                                          │ ▸ Show on map       │
                                                          │ ▸ Live video (3 cam)│
                                                          │ ▸ Trip timeline     │
                                                          │ ▸ Send message      │
                                                          │ ▸ History ▸         │
                                                          │ ─────────────────── │
                                                          │ ⚠ Overspeed 14:31   │
                                                          │ ⚠ Idle 13:55 (4m)   │
                                                          └─────────────────────┘
```

### 2.3 Map Layers (toggle in left rail)

| Layer | Source | Default |
|---|---|---|
| **Vehicles** | latest positions (Redis) | on |
| **Geofences** | PG geofences | on (admin only) |
| **Routes** | assigned trip routes | on (if active trips) |
| **Traffic** | map provider | off |
| **AI heatmap** | AI alert density (ClickHouse) | off |
| **Weather** | map provider | off |

### 2.4 Vehicle Markers

- **Shape** encodes type (truck/van/car), **color** encodes status (cyan active / yellow idle / rose overspeed / slate offline).
- **Rotation** = heading; size scales subtly with zoom.
- Above ~2,000 in view → **server-side clustering** (`GET /tracking/clusters?bbox&zoom`) returns aggregated markers with counts. Clicking a cluster zooms in.
- Hover → tooltip (vehicle, driver, speed, last update age).
- Click → selection + right **Drawer** (vehicle detail + quick actions).

### 2.5 Vehicle Drawer (right slide-over)

The drawer is the **control center** for one vehicle — never a page navigation:

- Header: vehicle name + status pill + live freshness dot.
- **Quick facts**: speed, heading, odometer, driver, current trip, ignition, address (reverse-geocoded).
- **Quick actions**: Follow (camera tracks vehicle), Live Video (opens Video Dashboard for this vehicle's cameras), Trip Timeline, Send Message, History (Replay), Send Command.
- **Recent events**: overspeed, idle, geofence, DTC, AI alerts (last 5) — click → jumps map+timeline.

### 2.6 Behaviors

- **Follow mode**: camera locks to a moving vehicle; released on manual pan.
- **Geofence editor overlay**: draw polygon/circle on map → create geofence (admin).
- **Multi-select**: shift-drag to box-select vehicles → bulk action bar (message, assign, export).
- **Right-click context menu** on a vehicle: directions-to, nearest vehicle, create geofence-here.
- **URL state**: bbox, selected vehicle, layers, filters — all shareable as a deep link.

### 2.7 Performance & Scale

- Vector tiles (Mapbox GL) render up to ~10k markers before clustering kicks in.
- Live updates batched (max 10 msgs/s to a client) to avoid marker jitter.
- "Pause live" toggle freezes the map for inspection (e.g., screenshot for incident).

---

## 3. Video Dashboard

The **video operations surface** — live view, playback, AI event review, and the fleet video wall. See `docs/modules/VideoPlatform.md` for the underlying platform.

### 3.1 Purpose

Safety review and live visibility: *show me what happened in that harsh-brake event; let me watch the cab cam of truck 42 right now; put my 16 highest-risk vehicles on the wall.*

### 3.2 Layout — Wireframe (Event Review Mode)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ FleetVision ▾ Acme   ⌕ Search clips/vehicles…     🔔  ?    JD ▾              │
├───────────┬──────────────────────────────────────────────────────────────────┤
│ ▶ Live     │ Video  ▸ Event Review                          [Live ▾] [Export]│
│ ▤ Events ◀│ ──────────────────────────────────────────────────────────────── │
│ ▦ Wall     │ Filters: Type ☑HarshBrk ☑FCW  Vehicle: All ▾  Date: Today ▾  🔎 │
│ □ Recordings│ ┌──────────────────────────────────────────────┬───────────────┐│
│            │ │  ▶ Player                            Truck-42 │ Event list    ││
│            │ │  ┌──────────────────────────────────────────┐ │ ───────────── ││
│            │ │  │                                           │ │ ● FCW  14:31  ││
│            │ │  │      [live forward-cam video frame]       │ │ Truck-42      ││
│            │ │  │      AI boxes: 🚗 car (0.91)              │ │ MAJOR  ◀ now  ││
│            │ │  │                                           │ │ ● Brake 14:30 ││
│            │ │  │                                           │ │ Truck-42      ││
│            │ │  └──────────────────────────────────────────┘ │ ● Distract    ││
│            │ │  ◄◄  ▶/⏸  ►►   14:30:55 / 14:31:30  🔊 ⚙     │ 14:28 Van-07  ││
│            │ │ ┌─ Timeline (Truck-42, 14:00–15:00) ────────┐ │ ● FCW 14:12   ││
│            │ │ │ ▮▮▮▮▮▮▮▮▮▮▮▮    ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮  drive  │ │ Truck-55      ││
│            │ │ │        ◉ brake    ◉ FCW ◉ FCW  events     │ │ ● Smoke 13:55 ││
│            │ │ │ ▮▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯  │ │ Bus-12        ││
│            │ │ └────────────────────────────────────────────┘ │ [Load more]   ││
│            │ └──────────────────────────────────────────────┴───────────────┘│
└───────────┴──────────────────────────────────────────────────────────────────┘
```

### 3.3 Modes (top tabs)

| Mode | Use |
|---|---|
| **Live** | open a live stream from any camera (§3.4) |
| **Event Review** | triage AI/behavior events with linked clips (default for safety officers) |
| **Video Wall** | multi-vehicle grid (§3.5) |
| **Recordings** | browse/search continuous + clip library (§3.6) |

### 3.4 Live View

- Vehicle/channel picker → opens a WebRTC `VideoTile` (sub-second, glass-to-glass < 1s).
- Up to 4 simultaneous cameras per vehicle (forward/driver/rear/cargo) in a 2×2 grid.
- Overlays: latency badge, REC dot if recording, AI bounding boxes (toggle).
- Idle live auto-closes after 5 min (cost control, per VideoPlatform §7.5).

### 3.5 Video Wall

- Grid of live tiles (2×2 up to 4×4 = 16 vehicles) — one forward-cam each by default.
- **Spotlight mode**: one large tile + thumbnails (bandwidth-friendly).
- **Alert pop-in**: a tile highlights red + chimes when its vehicle raises an AI/event alert; optional auto-spotlight for 30s.
- Bandwidth-aware: cellular clients capped to 4 tiles at 360p; wired NOCs get 16 at 720p.

### 3.6 Event Review (Safety Workflow)

The flagship safety flow — turning a stream of AI/behavior events into coaching actions:

1. **List** of events (left), filtered by type/severity/vehicle/date, sorted newest-first.
2. Select → **Player** loads the linked clip auto-cued to the event ± pre-buffer.
3. **Timeline** under the player shows the event markers within the trip — scrub to context.
4. Per event, an inspector panel: driver, vehicle, location (mini-map), speed, AI confidence, model version.
5. Actions: **Acknowledge** / **Mark false-positive** (feeds model training) / **Assign coaching** (to driver-mgmt) / **Add to incident** (compliance) / **Export MP4**.

### 3.7 Playback Controls

- Standard transport: play/pause, step frame, 0.5×–8× speed, scrub.
- **Scrub the timeline → seeks the player** (HLS, byte-accurate).
- Click any event marker → player jumps there with ±30s context.
- Multi-camera sync: scrubbing the timeline moves all 4 cameras together.

### 3.8 Privacy & Consent Indicators

- Driver-facing cameras show a "cabin cam" badge; users in jurisdictions requiring consent see a banner if a driver has not consented (and the channel is disabled).
- AI overlays on cab cam show only gaze/pose boxes (no face recognition), with a one-line privacy reminder.

---

## 4. Maintenance Dashboard

The **maintenance operations surface** for fleet managers and shop managers — planned and corrective work, parts, and vehicle health. See `docs/modules/Vehicle-Maintenance.md`.

### 4.1 Purpose

Keep vehicles on the road: *What's due? What's broken? What parts do I need? Are we on budget?*

### 4.2 Layout — Wireframe

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ FleetVision ▾ Acme   ⌕ Search…     🔔  ?    JD ▾                              │
├───────────┬──────────────────────────────────────────────────────────────────┤
│ ⚙ Maintain │ Maintenance  ▸ Overview                                        │
│  ▸ Overview│ ──────────────────────────────────────────────────────────────── │
│  Work Order│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│  Plans     │ │ Due ≤7d │ │ Overdue │ │ Open WO │ │ In Shop │ │MTD Cost │    │
│  Parts     │ │   18    │ │   4  ●  │ │   37    │ │   6     │ │ $48.2k  │    │
│  Vendors   │ │ ▲ +3    │ │         │ │         │ │         │ │ ▼ 8%    │    │
│  Costs     │ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘    │
│            │                                                                  │
│            │ ┌────────────────────────────────┐ ┌──────────────────────────┐ │
│            │ │ Preventive Maintenance Due      │ │ Active Work Orders       │ │
│            │ │ ─────────────────────────────── │ │ ──────────────────────── │ │
│            │ │ Vehicle      Service    Due     │ │ WO-1122  Truck-19        │ │
│            │ │ Truck-42   Oil change  340mi ●  │ │ Brakes · IN_PROGRESS     │ │
│            │ │ Van-07     Tire rot.   120mi    │ │ Tech: A. Patel  ▸ 70%    │ │
│            │ │ Bus-12     Insp. A     2d  ●    │ │ ──────────────────────── │ │
│            │ │ Truck-55   Air filter 850mi     │ │ WO-1123  Van-03          │ │
│            │ │ Truck-19   DPF clean   1d  ●●   │ │ Diag · PARTS_HOLD        │ │
│            │ │                  [Schedule ▾]   │ │ awaiting: brake pads     │ │
│            │ └────────────────────────────────┘ │              [Reorder]    │ │
│            │                                    │ WO-1124  Bus-12  QC  95%  │ │
│            │ ┌────────────────────────────────┐ │              [View all]   │ │
│            │ │ Vehicle Health (DTC alerts)     │ └──────────────────────────┘ │
│            │ │ ● Truck-19  P0420 catalytic     │                              │
│            │ │ ● Bus-12    P0171 lean          │ ┌──────────────────────────┐ │
│            │ │ ● Van-03    C0035 ABS sensor    │ │ Maintenance Cost (90d)    │ │
│            │ └────────────────────────────────┘ │   ▂▃▂▄▃▅▄▃▂▄▅▃▄▂▃▅▄▃      │ │
│            │                                    │  by category:              │ │
│            │                                    │  ▮ Labor  ▮ Parts  ▮ Vendor│ │
│            │                                    └──────────────────────────┘ │
└───────────┴──────────────────────────────────────────────────────────────────┘
```

### 4.3 Components

- **Stat cards**: Due ≤7d, Overdue (red, with count), Open WOs, In Shop, MTD Cost (vs budget).
- **PM Due list**: ranked by criticality (overdue first). Each row → "Schedule" → opens Work Order create modal pre-filled from the maintenance plan.
- **Active Work Orders**: live status (OPEN, DIAGNOSING, PARTS_HOLD, IN_PROGRESS, QC, COMPLETED) with technician + progress %.
- **Vehicle Health (DTCs)**: from telemetry; clicking opens the vehicle's maintenance history + a "Create WO from DTC" action.
- **Cost chart**: 90-day trend by category (labor / parts / vendor / tire / fuel-system).

### 4.4 Work Order Detail (Drawer)

```
┌─────────────────────────────────────┐
│ WO-1122  ▸ IN_PROGRESS         ⋯     │
│ Truck-19  ·  Brakes (front)          │
│ ──────────────────────────────────── │
│ Opened: 2026-08-01   Tech: A. Patel  │
│ Priority: HIGH    Vendor: In-house   │
│ ──────────────────────────────────── │
│ Tasks                                │
│ ☑ Inspect pads         1.0h          │
│ ☑ Replace pads (front) 1.5h          │
│ ☐ Machine rotors       est 0.5h      │
│ ☐ Road test            est 0.3h      │
│ ──────────────────────────────────── │
│ Parts                                │
│ Brake pad set   2  × $84.00          │
│ Brake cleaner   1  × $7.50           │
│                            [+ Add]   │
│ ──────────────────────────────────── │
│ Labor: 2.5h × $95   $237.50          │
│ Parts:              $175.50          │
│ Total:              $413.00          │
│ ──────────────────────────────────── │
│ [Complete]  [Pause]  [Add note]      │
└─────────────────────────────────────┘
```

### 4.5 Behaviors

- **Create WO** from: PM plan, DTC, manual, DVIR defect (consumes `compliance.dvir.defect-found.v1`), or driver report.
- **Parts reservation**: when a part is added, stock is checked; insufficient → PARTS_HOLD with one-click reorder.
- **Notifications**: tech assigned, parts arrived, QC pass/fail — all via notification-service.
- **Cost rollup** feeds asset-lifecycle TCO in real time.

---

## 5. Admin Panel

The **configuration surface** for tenant admins — users, fleets, policies, devices, integrations, billing, SSO. See `docs/modules/Authentication.md` (users/SSO), `docs/modules/Telemetry-Device-Management.md` (devices), `docs/modules/Billing-Tenant-Management.md` (billing).

### 5.1 Purpose

One place to configure the tenant: *who has access, how the fleet is organized, what the rules are, what we pay for.*

### 5.2 Information Architecture

```
Admin Panel
├── Organization     (org tree, divisions)
├── Users & Roles    (users, roles, permissions, MFA policy)
├── Fleets & Vehicles(fleet hierarchy, vehicle import)
├── Devices          (provision, pair, firmware)
├── Geofences        (manage all geofences)
├── Policies         (speed, idle, HOS, recording)
├── Notifications    (rules, recipients, escalation, quiet hours)
├── Integrations     (SSO, ERP, fuel cards, HR/SCIM, webhooks)
├── API Keys         (partner/developer keys)
├── Billing          (subscription, usage, invoices, payment)
├── Audit Log        (immutable activity log)
└── Settings         (locale, units, branding, data retention)
```

### 5.3 Layout — Wireframe (Users & Roles)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ FleetVision ▾ Acme — Admin                                              JD ▾  │
├────────────────────┬─────────────────────────────────────────────────────────┤
│ Organization       │ Users & Roles       [MFA policy] [SCIM sync]  [+ User]  │
│ Users & Roles  ◀   │ ──────────────────────────────────────────────────────── │
│ Fleets & Vehicles  │ Filter: Role ▾  Status ▾  Fleet ▾  ⌕ Search…     [Bulk ▾]│
│ Devices            │ ┌──────────────────────────────────────────────────────┐│
│ Geofences          │ │ Name          Email           Role         MFA  Last  ││
│ Policies           │ │ ──────────────────────────────────────────────────── ││
│ Notifications      │ │ John Doe     jdoe@acme.com  Fleet Admin  ✅  2h      ││
│ Integrations       │ │ Mei Chen     mchen@acme.com Dispatcher  ✅  5m ●    ││
│ API Keys           │ │ Ana Ruiz     aruiz@acme.com Mechanic    —   1d       ││
│ Billing            │ │ Tom Keita    tkeita@acme.com Driver     —   3d       ││
│ Audit Log          │ │ …                                                 ▦  ││
│ Settings           │ └──────────────────────────────────────────────────────┘│
│                    │                                                         │
│                    │ Roles (custom)          [+ Role]                         │
│                    │ ▸ Fleet Admin   (9 perms)   3 users                      │
│                    │ ▸ Dispatcher    (6 perms)   7 users                      │
│                    │ ▸ Night Driver  (custom)    12 users  [Edit] [Delete]    │
└────────────────────┴─────────────────────────────────────────────────────────┘
```

### 5.4 Key Surfaces

- **Users & Roles**: CRUD users; assign roles with scope (tenant/org/fleet); MFA enforcement; SCIM 2.0 sync status (HR system integration).
- **Devices**: provision devices, pair to vehicles, push firmware (OTA) with staged rollout controls, view device health.
- **Policies**: tenant/fleet-level speed limits, idle thresholds, HOS ruleset, recording policies (per VideoPlatform), data retention.
- **Integrations**: SSO (OIDC/SAML) setup wizard with JIT provisioning toggle; ERP/fuel-card/HR connectors with credential vault; webhooks.
- **Billing**: current subscription, tier, usage meters vs quota (live), invoices, payment method, download/export.
- **Audit Log**: immutable (`audit.*` events from ClickHouse), filterable, exportable for compliance; legal-hold aware.

### 5.5 Conventions

- **Two-column settings**: nav (left) + content (right) — same shell as the product, distinct nav.
- **Sensitive actions** (delete tenant, revoke all sessions, change SSO) require **step-up MFA** and a typed confirmation.
- **Bulk import** (CSV) for users, vehicles, geofences with dry-run preview.
- **Brandable**: white-label header logo, primary color, custom subdomain (Enterprise).

---

## 6. Mobile App

The **driver app** (React Native, iOS + Android) — the in-cab companion. See driver persona; HOS/DVIR/Trip from `docs/modules/Compliance-Safety.md`, `docs/modules/Trip-Route-Management.md`.

### 6.1 Purpose & Constraints

A driver's phone is mounted in-cab, glanced at while driving, and used at stops. The app is **eyes-free most of the time, glanceable, and large-touch**. It must work offline (cellular dead-zones) and sync on reconnection.

### 6.2 Design Principles (Mobile-specific)

- **One thumb, one tap** for the top 3 actions (status change, arrive, log break).
- **Glanceable**: status HOS clock + ETA always visible at top.
- **Offline-first**: every write queued locally; conflicts resolved on sync.
- **Audio + haptic** feedback (driver shouldn't look to confirm).
- **Driving lock**: when vehicle in-motion + speed > 8 km/h, interactive screens lock (regulatory + safety); only voice remains.

### 6.3 App Structure (Bottom Tab Bar)

```
   ┌────────┬────────┬────────┬────────┐
   │  Home  │  Trips │  Logs  │  More  │
   │   🏠   │   🛣️   │  ⏱ HOS │   ⚙    │
   └────────┴────────┴────────┴────────┘
```

### 6.4 Home Screen — Wireframe

```
   ┌─────────────────────────────────┐
   │  ☰   FleetVision        🔔  JD  │
   ├─────────────────────────────────┤
   │  ─── Duty Status ─────────────  │
   │                                 │
   │     ╭─────────────────────╮     │
   │     │   DRIVING  ◉         │     │  ← huge, color-coded
   │     │                       │     │
   │     │   3h 12m remaining    │     │  ← HOS countdown (11h limit)
   │     │   of 11h drive limit  │     │
   │     ╰─────────────────────╯     │
   │                                 │
   │   [ Off Duty ] [ Sleeper ]      │
   │   [ On Duty ]  [ Driving ◉ ]    │  ← 4 big status buttons
   │                                 │
   │  ─── Current Trip ────────────  │
   │  TR-4421  →  Depot-North        │
   │  ETA 14:42  (28 min)            │
   │  Next stop: Customer A          │
   │  [ Navigate ▸ ]  [ Arrived ✓ ]  │
   │                                 │
   │  ─── Quick Actions ───────────  │
   │  [ DVIR ] [ Fuel ] [ Message ]  │
   │  [ Documents ] [ Behavior ▸ 92 ]│
   └─────────────────────────────────┘
```

### 6.5 Key Screens

| Screen | Purpose |
|---|---|
| **Home (Duty Status)** | big status clock + change duty + current trip |
| **Trips** | assigned/active trip; turn-by-turn handoff to maps; arrive/depart; POD capture |
| **Logs (HOS)** | today's HOS log (the FMCSA grid), certify, edit with annotation, recap (8-day) |
| **DVIR** | pre/post-trip inspection checklist; defect capture (photo + severity); e-signature |
| **Fuel** | log a fuel purchase (auto-matched from fuel cards where possible) |
| **Messages** | dispatch ⇄ driver messages (read-aloud when driving) |
| **Behavior** | personal driver score + recent events (coaching) |
| **Documents** | license, registration, permits (upload + expiry alerts) |
| **Settings** | offline maps download, units, language, quiet hours, biometric login |

### 6.6 HOS Log Grid (FMCSA standard)

The HOS screen renders the regulatory **grid** (24h × status bands) drivers and inspectors know:

```
   0    2    4    6    8   10   12   14   16   18   20   22   24
   │    │    │    │    │    │    │    │    │    │    │    │    │
   ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
OFF│████│████│████│     │     │     │     │     │     │     │    │
   ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
SB │    │    │    │█████│█████│     │     │     │     │     │    │
   ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
DR │    │    │    │     │     │█████│█████│█████│████│     │    │
   ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
ON │    │    │    │     │     │     │     │     │    │████│████│
   │    │    │    │    │    │    │    │    │    │    │    │    │
   OFF    SLEEPER         DRIVING              ON-DUTY
```

Editable (with reason + annotation, tamper-evident — hash chain shown on tap), certifiable with signature.

### 6.7 POD Capture

```
   ┌─────────────────────────────┐
   │  Proof of Delivery    ✕     │
   │  ─────────────────────────  │
   │  Stop: Customer A           │
   │  ┌───────────────────────┐  │
   │  │                       │  │
   │  │   [ camera preview ]  │  │  ← capture signature / photo
   │  │                       │  │
   │  └───────────────────────┘  │
   │  Recipient name: ________   │
   │  Notes (opt):   __________  │
   │  ─────────────────────────  │
   │  Location: pinned ✓  14:42  │  ← geo + timestamp auto
   │                             │
   │   [ Cancel ]   [ Submit ✓ ] │
   └─────────────────────────────┘
```

### 6.8 Offline & Sync

- Local queue (SQLite) for: duty-status changes, DVIR, POD, fuel logs, messages.
- On reconnection: sync with conflict resolution (server-wins for HOS edits with audit; client-wins for new captures with id).
- Offline maps downloaded per region; turn-by-turn works offline.
- Sync status indicator (cloud icon: synced / pending / error).

---

## 7. User Flow

End-to-end journeys across surfaces. Each is numbered; steps reference the screen/section above.

### 7.1 Authentication & First-Run

```
[1] User opens app  →  [2] Login (email+pwd)  →  [3] (if MFA) TOTP/WebAuthn
   →  [4] MFA required?  ─yes→  [5] MFA verify  →  [6] Dashboard
                       └no───────────────────────────▲
[0] SSO user: [1] → "Sign in with SSO" → IdP redirect → callback → [6]
First-run: [6] → onboarding checklist (profile, MFA, mobile app pair, fleet intro)
```
(See `docs/modules/Authentication.md` §13 for screen wireframes.)

### 7.2 Real-Time Incident Response (Dispatcher)

The canonical "something just happened" flow — the highest-value fleet-ops journey.

```
[1] Alert toast pops (OVERSPEED · Truck-42 · 128 km/h · 14:31)
        │  click
        ▼
[2] Map Dashboard opens, auto-centered on Truck-42, Drawer open
        │  click "Live Video"
        ▼
[3] Video Dashboard · Live · Truck-42 forward + cabin cam
        │  observe context
        ▼
[4] Click the linked event on the timeline → clip auto-cues
        │  confirm severity
        ▼
[5] Actions: Send message to driver / Create coaching note / Add to incident
        │
        ▼
[6] (if incident) Compliance module opens prefilled incident report
        │
        ▼
[7] Audit entry written; fleet manager notified; resolution tracked
```
**Design goal:** [1]→[4] under 15 seconds (one alert → live context).

### 7.3 Plan & Dispatch a Trip

```
[1] Trips ▸ New Trip
   → pick vehicle (filtered to available + HOS-eligible driver)
   → pick route (or auto-recommended)
   → set schedule
[2] Review → Dispatch
[3] Driver mobile app receives push → accepts
[4] Map dashboard shows trip polyline + ETA + progress
[5] Driver DVIR (pre-trip) → passes → Start Trip
[6] En route: live tracking, waypoint arrivals auto-logged
[7] At stop → POD capture (mobile)
[8] Complete trip → cost/mileage/behavior roll up → billing & analytics
```

### 7.4 Maintenance: From DTC to Repair

```
[1] Telemetry DTC (P0420) raised on Truck-19
        │  Kafka
        ▼
[2] Maintenance Dashboard · "Vehicle Health" shows red DTC
        │  click  →  "Create Work Order from DTC"
        ▼
[3] WO pre-filled (vehicle, fault code, suggested tasks)
        │  assign tech, schedule, add parts
        ▼
[4] WO IN_PROGRESS (tech updates tasks in shop-floor view)
        │  parts low? → auto-reorder
        ▼
[5] QC → Complete → cost rollup → TCO updated
        │
        ▼
[6] Vehicle returns to ACTIVE; maintenance history updated
```

### 7.5 Safety Event Review (Safety Officer)

```
[1] Video Dashboard · Event Review (default landing)
[2] Filter: today · FCW+HarshBrake · all vehicles
[3] Scroll list → pick event → player auto-cues clip
[4] Watch (±pre-buffer) → assess: real / false positive?
   ├─ real   → Assign coaching (driver) → goes to driver's Behavior tab + manager
   ├─ false  → Mark false-positive → feeds model training (closed loop)
   └─ severe → Add to Incident → Compliance workflow
[5] Event status: Acknowledged → Resolved
```

### 7.6 Driver: A Full Shift (Mobile)

```
[1] Login (biometric) → Home
[2] Pre-trip DVIR ✓ (defect? → photo + create WO link)
[3] Set status ON_DUTY → accept dispatched trip
[4] Navigate (handoff to maps) → status DRIVING (auto on motion)
[5] HOS countdown visible; alert at 10h45m; mandatory 30m break at 8h
[6] Arrive stop → POD capture
[7] Repeat stops; offline segments queue, sync on signal
[8] Fuel purchase → log (auto-matched card txn)
[9] End trip → status OFF_DUTY → Certify HOS log (signature)
[10] Behavior score updates; coaching notes appear if any
```

### 7.7 Admin: Onboard a New Vehicle (with device)

```
[1] Admin ▸ Fleets & Vehicles ▸ + Vehicle  → enter VIN/make/model
[2] Admin ▸ Devices ▸ + Provision  → scan device QR / enter IMEI
[3] Pair device ↔ vehicle
[4] (auto) first telemetry → device ACTIVE → Map shows vehicle
[5] Assign to fleet → set policies (speed, geofence, recording)
[6] (optional) enroll cameras → Video Dashboard shows channels
[7] Driver assigned → ready to operate
```

### 7.8 Admin: Configure SSO (Enterprise)

```
[1] Admin ▸ Integrations ▸ SSO ▸ + Configuration
[2] Pick protocol (OIDC/SAML) → enter IdP metadata/URL
[3] Map attributes (email, name, groups → FleetVision roles)
[4] Toggle JIT provisioning
[5] Test with a sample login → confirm user auto-created
[6] Enforce: "All users must use SSO after 7 days"
```

---

## 8. Wireframe Description

Annotated low-fidelity wireframes for the **primary screens** (those above plus key detail/flow screens). These are the blueprints the Figma high-fidelity mocks are built from. Each wireframe lists: **purpose**, **key regions**, **behaviors**, **states**.

> Conventions in wireframes: `[Btn]` action button · `▸` expandable · `●` indicator dot · `◉` active · `▮` filled bar · `○` empty · `⌕` search · `▾` dropdown.

### 8.1 Global Shell (all web surfaces)

```
┌─ TOP BAR (56px) ────────────────────────────────────────────────────┐
│ [logo] ▾Tenant/Fleet   ⌕ Global Search…   🔔  ?  [avatar] ▾         │
├─ SIDE NAV (240/72) ─┬─ MAIN ──────────────────────────────────────────┤
│ ⌂ Dashboard        │ Breadcrumb · Page title          [primary btn]  │
│ ◎ Map              │ ─────────────────────────────────────────────── │
│ ▦ Vehicles         │                                                  │
│ ▤ Drivers          │   (page content — see per-screen wireframes)    │
│ ➤ Trips            │                                                  │
│ ▶ Video            │                                                  │
│ ⚙ Maintenance      │                                                  │
│ ✓ Compliance       │                                                  │
│ ⛽ Fuel            │                                                  │
│ 📊 Reports         │                                                  │
│ ⚙ Admin (role-gated)│                                                 │
└────────────────────┴──────────────────────────────────────────────────┘
```
- **Behaviors**: side-nav collapses to icon-rail on `<lg`; remembers per-user. Global search (`Cmd+K`) jumps to entities + actions. Bell opens an alerts popover.
- **States**: disconnected banner under top bar; read-only banner if tenant suspended.

### 8.2 StatCard (reusable unit)

```
   ┌───────────────────┐
   │ ACTIVE VEHICLES   │  ← label (12px, neutral-500, uppercase)
   │      312          │  ← value (30px, neutral-900, tabular)
   │ ▲ +12  vs yest.   │  ← delta (12px, green/red arrow)
   │   ▁▂▄▃▅▆▅▄▃▂▁    │  ← sparkline (24px tall)
   └───────────────────┘
```
- Hover → tooltip with absolute numbers; click → drilldown (filter applied to target screen).

### 8.3 DataTable (reusable unit)

```
   [Filter bar: column filters · saved views ▾ · density ▾ · export ▾]
   ───────────────────────────────────────────────────────────────────
   ☐  Vehicle        Driver       Status      Speed    Last ●   ⋯
   ───────────────────────────────────────────────────────────────────
   ☐  Truck-42       M. Chen      ● Driving   128      8s  ●    ⋯
   ☐  Van-07         T. Keita     ○ Idle      0        2m       ⋯
   ☐  Bus-12         A. Patel     ◐ Stopped   0        5m       ⋯
   ☐  Truck-19       —            ○ Offline   —        2h       ⋯
   ───────────────────────────────────────────────────────────────────
   [Bulk bar appears on select: Message · Assign · Export · Clear]
   ◄ 1 2 3 … 84 ►                showing 1–25 of 2,084
```
- Virtualized; sticky header; column resize/show/hide/persist; saved views shareable by URL.

### 8.4 AlertsBell Popover

```
   ┌─ Alerts ──────────── All ●  Unread ●  Critical ● ─┐
   │ ● CRIT  Overspeed  Truck-42  14:31            ▸   │
   │ ● WARN  Idle 15m+  Van-07    14:28            ▸   │
   │ ● INFO  Geofence  Truck-19 entered Depot-N 14:20 ▸│
   │ ● CRIT  FCW       Truck-55  14:12            ▸   │
   │ ──────────────────────────────────────────────    │
   │            [Mark all read]   [Notification settings]│
   └───────────────────────────────────────────────────┘
```

### 8.5 Vehicle Detail Drawer (Map)

(See §2.5.) Regions: header (name/status/freshness), quick facts grid, quick actions list, recent events list, mini-trip-progress bar. Behaviors: slide-over from right; `Esc`/backdrop closes; "expand to page" arrow for full vehicle profile.

### 8.6 New Trip Modal

```
   ┌─ New Trip ────────────────────────── ✕ ┐
   │ Vehicle      [ Truck-42         ▾ ]    │
   │ Driver       [ M. Chen (11h left) ▾ ]  │  ← HOS-aware filtering
   │ Route        [ Auto-recommend   ▾ ]    │
   │              ▸ or pick existing        │
   │ Pickup       [ Customer A    09:00 ]   │
   │ Stops        [+ Add stop]              │
   │ Delivery     [ Depot-N       16:00 ]   │
   │ Load         [ None ▾ ]  (HAZMAT? ☐)   │
   │ ─────────────────────────────────────  │
   │   [Cancel]            [Review ▸]       │
   └────────────────────────────────────────┘
```

### 8.7 Geofence Editor (Map overlay)

```
   ┌─ Draw Geofence ──────────── ✕ ┐
   │ Type: ◉ Polygon  ○ Circle  ○ Corridor │
   │ ───────────────────────────── │
   │   [ map with draw-in-progress ]│
   │   click to add vertices        │
   │ ───────────────────────────── │
   │ Name      [ Depot-North     ]  │
   │ Triggers  ☑ Enter  ☑ Exit      │
   │           ☐ Dwell (> ___ min)  │
   │ Apply to  ◉ Fleet: All  ▾      │
   │ Alert     [ Ops team        ▾] │
   │ ───────────────────────────── │
   │    [Cancel]      [Save geofence]│
   └─────────────────────────────────┘
```

### 8.8 HOS Violation Toast (Web + Mobile)

```
   ┌──────────────────────────────────────────┐
   │ ⚠ HOS LIMIT APPROACHING          ✕       │
   │ Truck-42 · M. Chen · 10h45m of 11h drive │
   │ [Notify driver]  [View HOS log]          │
   └──────────────────────────────────────────┘
```
- Auto-dismiss after 20s unless Critical; persists in AlertsBell.

### 8.9 Video Event Review Detail Panel

```
   ┌─ Event: FCW · Truck-42 · 14:31 ──────── ✕ ┐
   │ [Player showing frame at 14:31:08]        │
   │ ◄◄ ▶ ►►   14:30:55 / 14:31:30   🔊 ⚙     │
   │ ───────────────────────────────────────── │
   │ Confidence 0.91   Model fcw-v3            │
   │ Speed 128 km/h   Clear, dry               │
   │ Location ▸ mini-map                       │
   │ Driver M. Chen · score 92                 │
   │ ───────────────────────────────────────── │
   │ [Acknowledge] [False positive] [Coach ▾]  │
   │ [Add to incident]        [Export MP4]     │
   └────────────────────────────────────────────┘
```

### 8.10 Settings — Notification Preferences

```
   ┌─ Notification Preferences ──────────────┐
   │ Channel          Email  SMS  Push  In-app│
   │ ─────────────────────────────────────── │
   │ Critical alerts   ☑     ☑    ☑     ☑   │
   │ Overspeed         ☑     ☐    ☑     ☑   │
   │ Geofence          ☐     ☐    ☑     ☑   │
   │ Maintenance due   ☑     ☐    ☐     ☑   │
   │ Daily summary     ☑     ☐    ☐     ☐   │
   │ ─────────────────────────────────────── │
   │ Quiet hours: 22:00 – 06:00 (local)       │
   │ Exception: Critical always ☑             │
   │ Escalation: unacked Critical → manager   │
   │ after 15 min                             │
   └──────────────────────────────────────────┘
```

### 8.11 Empty State (reusable)

```
   ┌──────────────────────────────────────┐
   │                                      │
   │            [ illustration ]          │
   │                                      │
   │        No vehicles yet               │
   │   Provision a device to see your     │
   │   fleet on the map.                  │
   │                                      │
   │       [ + Provision device ]         │
   └──────────────────────────────────────┘
```
Used on every first-run / zero-data view, with a context-specific CTA.

### 8.12 Mobile — DVIR Checklist

```
   ┌─────────────────────────────┐
   │ ✕  Pre-Trip DVIR   Truck-42  │
   │ ─────────────────────────── │
   │ EXTERIOR                    │
   │ ☐ Tires & pressure          │
   │ ☐ Lights & reflectors       │
   │ ☐ Brakes (air/hydraulic)    │
   │ ☐ Coupling devices          │
   │ INTERIOR                    │
   │ ☐ Horn                      │
   │ ☐ Wipers & washers          │
   │ ☐ Mirrors                   │
   │ ☐ Seatbelt                  │
   │ ─────────────────────────── │
   │ Defect found?  [ + Report ] │
   │ ─────────────────────────── │
   │ Signature:  [ sign here ]   │
   │                             │
   │  [Save draft]   [Submit ✓ ] │
   └─────────────────────────────┘
```

---

## Appendix A: Surface → Persona → Permission Matrix

| Surface | Dispatcher | Fleet Mgr | Safety Off. | Mechanic | Driver | Admin | Exec |
|---|---|---|---|---|---|---|---|
| Fleet Dashboard | ✅ | ✅ | ✅ | ◐ | — | ✅ | ✅ (ro) |
| Map Dashboard | ✅ | ✅ | ✅ | ◐ | — | ✅ | ✅ (ro) |
| Video Dashboard | ◐ | ✅ | ✅ | — | — | ✅ | — |
| Maintenance Dashboard | ◐ | ✅ | — | ✅ | — | ✅ | ✅ (ro) |
| Compliance (HOS/DVIR) | ◐ | ✅ | ✅ | — | app-only | ✅ | — |
| Admin Panel | — | ◐ | — | — | — | ✅ | — |
| Mobile App | — | — | — | — | ✅ | — | — |
| Reports/Analytics | ✅ | ✅ | ✅ | ◐ | — | ✅ | ✅ |

✅ full · ◐ scoped · ro read-only · — no access. Permissions enforced per `docs/modules/Authentication.md` §11 RBAC.

## Appendix B: Accessibility Checklist

- [ ] All actions keyboard-reachable; visible focus order
- [ ] Color contrast AA in both light & dark themes
- [ ] No color-only signals (pair with icon/label)
- [ ] Live regions announce map/alert updates
- [ ] Reduced-motion respected (no pulsing)
- [ ] Touch targets ≥ 44px (mobile)
- [ ] Tables: `scope`, `caption`; sortable via keyboard
- [ ] Video: captions/transcripts for any with audio
- [ ] Forms: inline error + `aria-describedby`
- [ ] Tested with screen readers (NVDA, VoiceOver, TalkBack)

## Appendix C: Frontend Implementation Mapping

| Design-system token | Implementation |
|---|---|
| Colors / type / spacing | `@fleetvision/ui/tokens` (Tailwind config + CSS vars) |
| Components | `@fleetvision/ui` (React 18 + TS 5), Storybook 8 |
| Icons | `lucide-react` |
| Maps | `mapbox-gl` + custom `MapCanvas` wrapper |
| Charts | `visx` / `recharts` (composable, accessible) |
| Tables | `@tanstack/react-table` + virtualization |
| State | React Query (server) + Zustand (UI) |
| Real-time | `socket.io-client` (web), reconnecting ws (mobile) |
| Forms | `react-hook-form` + `zod` schemas (shared with backend) |
| i18n | `react-i18next` |
| Mobile parity | React Native + `@fleetvision/ui-native` (mirrors DS) |

## Appendix D: Traceability

| Source | This Document |
|---|---|
| `00_Project_Vision.md` (personas, "consumer-grade UX" pillar) | §0, persona table |
| `01_Master_Architecture.md` §2 (React 18 + TS, React Native) | §0, Appendix C |
| `docs/modules/Authentication.md` (RBAC, MFA, SSO) | §5, §7.1, §7.8, Appendix A |
| `docs/modules/Tracking-Monitoring.md` (map, geofences) | §2 |
| `docs/modules/GPSEngine.md` (trip/stop/idle, behavior, replay) | §1.4, §2.5, §7.6 |
| `docs/modules/VideoPlatform.md` (live/playback/wall/AI) | §3, §7.5, §8.9 |
| `docs/modules/Vehicle-Maintenance.md` (WO/PM/parts/DTC) | §4, §7.4 |
| `docs/modules/Compliance-Safety.md` (HOS, DVIR, incidents) | §6.6, §7.6, §8.12 |
| `docs/modules/Trip-Route-Management.md` (dispatch, POD) | §7.3, §6.7 |
| `docs/modules/Billing-Tenant-Management.md` (tiers, usage) | §5.4 (Billing) |

---

*This UI/UX Design document is the canonical interaction & layout reference for FleetVision. It is paired with the Figma component library (visual source of truth) and Storybook (code), and is reviewed by Product Design + Frontend Architecture. Screen-level high-fidelity mocks live in Figma; this document owns the information architecture, flows, and behavior specs.*
