# Scope

## In scope

- MD300 **all DMS types** and **ADAS** alarms.
- Automatic **driver (cabin) photo** when the alarm is created.
- Automatic **15 s driver video with audio** (5 s before + 10 s after).
- Automatic ingest **onto the platform** (local capture + sync if GPRS was down).
- Cooldown: at most one capture set per alarm type per minute.
- **30-day** platform retention of that media.
- Operator can click once to view photo and play/download the clip as evidence of that alarm.
- Visible handling when capture fails but the alarm still exists.

## Out of scope

- Redesign of live video wall.
- Continuous 24/7 recording policy.
- Road-facing ADAS video as the evidence clip (driver/cabin only).
- Non-MD300 protocols.
- Manual D03 “take photo now” already on the alarm page (exists; not this request).
- Changing which DMS behaviors are enabled (C90-style device config).
- Auto-open of evidence without a click.
- Coaching/incident auto-attach, tenant on/off UI, face blur.

## Future improvements

- Auto-attach evidence to coaching/incident records.
- Tenant admin UI to pick types and duration.
- Face blur / privacy modes.

## Changelog

- 2026-09-07: Initial.
- 2026-09-07: ADAS in (cabin media); offline sync; audio; 30-day retention; click-to-load display.
