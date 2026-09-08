# Business problem

Operators today configure MDVR alarm/event linkage in the **vendor mobile app** (Meitrack «My settings» / Parameter / Alarm):

- Per-event rows (overspeed, geo-fence enter/exit, battery, GPS lost, digital inputs, …)
- Per-event **Link Sett**: associated phones (SMS/Call), alarm head label, delay recording seconds, transfer (GPRS/FTP/VOICE), hardware outputs, per-channel recording/screenshot/OSD

FleetVision already exposes many of the same capabilities as **raw TCP commands** (Command Center / Device Config Wizard), but:

1. There is **no product UI** that mirrors the device app’s Alarm / Parameter screens.
2. Operators must know Meitrack command codes (e.g. B99, B07) instead of event names and checkboxes.
3. Read/refresh of current device settings is incomplete or hard to use compared to the app’s Refresh + Link Sett flow.

**Requested outcome:** Bring that **full device-app configuration** into FleetVision so operators do not need the vendor app for day-to-day parameter work.

## Changelog

- 2026-09-08: Initial.
