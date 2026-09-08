# Known Limitations

## MD300 / media

- Native A9A dialback live video is not reliable on MD300; live path is AB2 + MediaMTX + HLS (`docs/implementation/MDVR_LIVE_VIDEO.md`).
- AB4 playback publishes to `<camera key>/pb`, not the live key. Using the live key shows live video instead of the clip.
- HEVC on some cameras is transcoded to H.264 in MediaMTX (~5–10 s before HLS is ready).
- Alarm evidence (DMS JPEG + clip) is loaded only after the operator asks; it is not auto-fetched when the alarm is raised.
- Manual photo capture from the alarm drawer (`D03`) happens after the event, not at the DMS trigger instant.
- C90 configures DMS alert volume and which behaviors fire; it does not define photo/video capture duration.
- Event 126 packets may include a `photoName`. If the device did not store that file, D00 fails.

## Platform vs device

Whether MD300 actually writes a snapshot and a short event clip at DMS time depends on device firmware/settings. The platform currently consumes files if they exist; it does not own a confirmed “on every DMS alarm, capture N-second driver clip” device policy.

## Device Parameter → Alarm (Phase 1)

- FTP / VOICE / Screenshot / OSD / Output 3–7 are UI-visible but **disabled** (no 1:1 catalog encode yet).
- Alarm head (B91) has no protocol readback; Refresh fills heads from last ACKED SET params / local snapshot.
- Live Refresh (B99 GET + CB8) runs only for a **single** selected device; type bulk mode uses local snapshot only.
- Event table includes SOS + digital inputs **2–8 Active / 1–8 Inactive** (codes 2–16) + battery/speed/fence/GPS; MDVR protocol has **no Input 1 Active** row (code 1 = SOS).

## Device Parameter → Network (Phase 2A)

- Covers A21 / A23 / A11 / A12 / A15 only (no A25 IP3, ABB Wi‑Fi, AA3).
- Refresh uses **DB4** (+ history); multi-device mode is cache-only like Alarm.

## Device Parameter → Alerts+

- Covers **B07** speeding, **B10** towing (covers B08 vibration), **D79** harsh accel/brake, **C03** GPRS event mode.
- Most alert cmds have **no live readback**; Refresh uses DB4 overspeed for B07 + last SET history for the rest.
- Towing still requires device deep sleep (**A73=2**) — not set from this panel.
- DMS volume/behaviors remain under **AI / C90**.

## Device Parameter → Tracking+ 

- Covers **A13** cornering, **A14** distance, **A16** parking-schedule enable.
- A12 / A15 time intervals remain under **Network** (not duplicated).
- Refresh uses **DB4** (+ history); A16 may only come from last SET / history when absent from dump.

## Device Parameter → AI / C90 (Phase 4)

- Covers **C90** DMS alert volume + behavior toggles; **CD1** calibration is a one-shot action.
- Does **not** set photo/video capture duration (separate product/requirements if needed).
- ADAS-specific thresholds beyond C90 are not in this Parameter section.

## Device Parameter → Media (Phase 3)

- Covers **BB8** speaker volume + **B64** FTP photo upload only.
- Live stream / playback / D03 capture remain Command Center catalog actions (not Parameter sett).
- Event-linked channel recording remains under Alarm (CB8), not duplicated here.

## Device Parameter → shared state (Phase 2B)

- Snapshots remain **client localStorage** only (no server `device_parameter_snapshots` yet).

## Drivers

- Assignment is **current vehicle only** (`assigned_vehicle_id`); there is no durable assignment history in fleet-service yet. `driver-management-service` from the module doc is not an app in this repo.
- Driver report meters are a rollup of the **currently** assigned vehicle’s meters — incorrect if the driver changed vehicles in the period (Phase 8 deferred true driver-activity).
- Alerts table has no `driver_id`; UI may show an optional `driver` string only. Reliable “alarms for this driver” needs assignment-at-event-time or a stamped id.

## Changelog

- 2026-09-08: Parameter Alarm event list expanded with MDVR Input 2–8 Active / 1–8 Inactive (codes 2–16).
- 2026-09-08: Device Parameter Alerts+ (B07/B10/D79/C03; limited live readback; A73 not included).
- 2026-09-08: Device Parameter Tracking+ (A13/A14/A16; A12/A15 stay under Network).
- 2026-09-08: Device Parameter Phase 4 AI/C90 (C90 + CD1; no capture-duration / ADAS extras).
- 2026-09-08: Device Parameter Phase 3 Media (BB8/B64 only; no live/playback/recording schedule UI).
- 2026-09-08: Device Parameter Phase 2B shared snapshot/probe foundation (localStorage only).
- 2026-09-08: Device Parameter Network Phase 2A slice (A21/A23/intervals; DB4 refresh; no A25/ABB).
- 2026-09-08: Device Parameter Alarm Phase 1 limitations (unsupported Link Sett fields; B91 no readback; bulk Refresh cache-only).
- 2026-09-08: Driver assignment / hours / alarm attribution gaps recorded (analysis `docs/analysis/driver-work-device-alarms/`).
- 2026-09-07: Initial limitations, including DMS evidence capture gap.
