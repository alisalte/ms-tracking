# Status

- Phase: **Input events shipped** — next candidate Network+ (A25/ABB)
- Implementation: Alarm (incl. I/O events) | Network | Tracking | Alerts | Media | AI/C90
- Requirements: Approved 2026-09-08; phase ladder confirmed through P4

## Progress

- [x] Phase 1A: event catalog + client Link Sett → B91/B99/CB8 composer + unit tests
- [x] Phase 1B: Command Center `parameter` tab, Event settings table, Link Sett drawer, i18n FA/EN
- [x] Phase 1C: B99/CB8 readback merge + history fallback, snapshot cache w/ source, unsupported controls disabled + tooltips
- [x] Phase 2A Network: Parameter sub-nav Alarm | Network; A21/A23/A11/A12/A15 form; DB4 Refresh
- [x] Phase 2B Configuration State / Readback foundation: shared snapshot + probe runner
- [x] Phase 3 Media: Parameter `section=media`; BB8 volume + B64 FTP photo form
- [x] Phase 4 AI / C90: Parameter `section=ai`; C90 DMS form + CD1 calibration action
- [x] Tracking+: Parameter `section=tracking`; A13 / A14 / A16 + DB4 Refresh
- [x] Alerts+: Parameter `section=alerts`; B07 / B10 / D79 / C03 (+ DB4 overspeed / history)
- [x] Input events: Alarm Event list + codes 2–16 (Active 2–8 / Inactive 1–8); code 1 remains SOS

## Changelog

- 2026-09-08: Analysis drafted.
- 2026-09-08: Implementation started — Alarm Parameter UI + Command Center tab.
- 2026-09-08: Phase 1C harden — readback Refresh, snapshot source column, disabled unsupported fields.
- 2026-09-08: Phase 2A Network — Parameter `section=network`, composite Network form + DB4 refresh.
- 2026-09-08: Phase 2B — `device-parameter-state` snapshot/probe foundation; Alarm + Network on shared Refresh path.
- 2026-09-08: Phase 3 Media — BB8 / B64 Media section; event CH recording remains under Alarm (CB8).
- 2026-09-08: Input events — Alarm Parameter table adds MDVR §1.3 codes 2–16 (no Input 1 Active in protocol).
- 2026-09-08: Alerts+ — Parameter `section=alerts` (B07/B10/D79/C03; B08 covered by B10; limited live readback).
- 2026-09-08: Tracking+ — Parameter `section=tracking` (A13/A14/A16; DB4 refresh; A12/A15 remain under Network).
- 2026-09-08: Phase 4 AI / C90 — C90 DMS volume/behaviors + CD1 calibration; no capture-duration control.
