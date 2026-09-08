# Functional requirements

*(Draft — scope of “کامل” not yet confirmed; see open-questions.)*

## FR-1 Device selection

- Select a registered Meitrack MDVR device (online/reachable preferred).
- Show connectivity / last ACK state before edit.

## FR-2 Alarm event list (screenshot parity)

- Show an **Event settings** table with columns analogous to the vendor app:
  - Event (localized name)
  - Alarm head
  - Delay recording time (s)
  - Operation → open Link Sett
- Support **Refresh** to reload from device (readback).

## FR-3 Alarm Link Sett (screenshot parity)

For a selected event, configure and save:

- Associated phone(s) with SMS / Call flags (up to 3 as in app, unless protocol differs)
- Event / Alarm head label
- Delay recording time (seconds)
- Alarm transfer linkage: GPRS, FTP, VOICE (as supported by device protocol)
- Alarm output linkage: Output1…OutputN (as supported)
- Per channel: Recording, Screenshot, OSD (for available channels)

Actions: Setting (apply) / Cancel.

## FR-4 Command outcome

- Show per-apply progress: queued → sent → acked / failed.
- On failure, keep prior values visible and show error detail.

## FR-5 Localization

- Persian (and English) labels for event names and fields (parity with existing command catalog FA strings where possible).

## FR-6 Permissions

- Gate by existing device-command permissions (exact permission key TBD / confirm).

## FR-7 (conditional) Full Parameter app

If product confirms “کامل” = entire vendor Parameter app (not only Alarm):

- Equivalent surfaces for other Parameter areas the app exposes (network, tracking, recording schedule, AI/DMS, etc.), organized like the app tabs/sections — still driven by on-device settings, not server Alarm Rules.

## Explicit non-confusion

- Platform **Alarm Rules** (`/alarms/rules`) remain a separate product; this feature is **on-device Parameter** configuration.

## Changelog

- 2026-09-08: Initial from Alarm screenshots + “full app config” request.
