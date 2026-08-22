# FleetVision — Page Visual Inventory (Phase 2.6)

Inventory of every user-facing route in `apps/web-dashboard`, audited against
`VISUAL_DESIGN_SYSTEM.md`. Compliance is judged on **actual composition**
(Breadcrumb → PageHeader → Toolbar → Content), not component imports:
verified via the Phase 2.5/2.6 screenshot matrices + source inspection.

Legend: **COMPLIANT** = follows the system as-is · **PARTIAL** = works but has
specific gaps · **NON_COMPLIANT** = violates the system.

## Protected (authenticated shell — sidebar + header + Breadcrumb)

| Route | Page | Current Status | Compliance | Required Work |
| ----- | ---- | -------------- | ---------- | ------------- |
| `/dashboard` | Fleet Dashboard (FleetDashboard) | PageHeader + 7 KPI tiles + activity/health charts + events + map preview; real data | COMPLIANT | — |
| `/map` | Live Tracking (MapPage) | Map-first chrome: overlay toolbar (title/LiveBadge/mode switch/history presets/counts), device panel, playback controls | COMPLIANT | Map overlays are exempt from PageHeader (canvas domain layout) |
| `/trips` | Trips list (TripsPage) | PageHeader + Toolbar + DataTable + honest empty state | COMPLIANT | — |
| `/trips/:id` | Trip detail (TripDetailPage) | Back link + PageHeader (id + route meta + status badge) + summary tiles + replay map + speed graph + timeline | COMPLIANT | Palette-driven event colors (fixed this phase) |
| `/video` | Video wall hub (VideoWallPage) | Tabs (wall/cameras/playback), toolbar, grid tiles, transport | COMPLIANT | Overlay chrome exempt from PageHeader |
| `/alarms` | Alarm Center (AlarmCenterPage) | PageHeader + stat chips + filters + live alarm feed/map | COMPLIANT | — |
| `/events` | Event Center (EventCenterPage) | PageHeader + live badge + filters + timeline table | COMPLIANT | — |
| `/notifications` | Notification Center (NotificationCenterPage) | PageHeader + actions + tabs + list + detail drawer | COMPLIANT | — |
| `/geofences` | Geofence management (GeofencePage) | PageHeader + create (gated) + filters + table + preview map; TailAdmin dialog with listbox selects | COMPLIANT | — |
| `/commands` | Command Center (CommandCenterPage) | PageHeader + device picker + catalog + history table | COMPLIANT | — |
| `/assets?tab=…` | Asset Management (AssetManagementPage) | PageHeader + per-tab Add + Tabs + fleet/vehicle/device tables (shared Table) + detail drawers | COMPLIANT | — |
| `/reports` | Reporting (ReportsPage) | PageHeader + range picker + section tabs + overview cards/charts + ReportsTable | COMPLIANT | — |
| `/maintenance` | Maintenance placeholder | UpcomingFeature empty state | COMPLIANT | Feature pages to come (future phase) |
| `/admin?section=…` | Admin Panel (AdminPage) | PageHeader + section nav + users/roles/permissions/settings/audit | COMPLIANT | Restructured this phase (header above split layout) |
| `/account/profile` | Profile (ProfilePage) | PageHeader + identity card + sessions/preferences | COMPLIANT | — |
| `*` | 404 (inline NotFoundPage) | Centered message + home link | COMPLIANT | Simple by design |

Redirects: `/fleets|/vehicles|/devices` → `/assets?tab=…`, `/` → `/dashboard`.

## Public (AuthLayout — centered card, brand panel)

| Route | Page | Current Status | Compliance | Required Work |
| ----- | ---- | -------------- | ---------- | ------------- |
| `/login` | Login | Card + brand panel, org/email/password, i18n | COMPLIANT | — |
| `/register` | Register | Same shell | COMPLIANT | — |
| `/forgot-password` | Forgot password | Same shell | COMPLIANT | — |
| `/reset-password` | Reset password | Same shell | COMPLIANT | — |
| `/mfa/verify` | MFA verify | OTP inputs | COMPLIANT | — |

## Totals

**21 routes** (16 protected + 5 public) — **21 COMPLIANT / 0 PARTIAL / 0
NON_COMPLIANT** at the close of Phase 2.6. (Entering the phase, 11 pages
hand-rolled their headers and 6 components carried raw hex/rose colors →
fixed; see `PHASE_2_6_VISUAL_CONFORMANCE.md`.)

Tenants / API Keys / Work Orders have **no routes** — not yet built product
surface (tracked as technical debt, not visual non-compliance).
