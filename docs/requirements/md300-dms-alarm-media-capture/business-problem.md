# Business Problem

## Why this is needed

DMS alarms on MD300 (fatigue, phone, smoking, driver absence, …) tell the fleet that a driver behavior event occurred. Without a still image and a short video of the driver at that moment, the operator cannot verify the event, coach the driver, or defend the alarm.

## What problem it solves

- Proof at the exact alarm time, not a photo taken later from the alarm drawer.
- A few seconds of motion (head pose, phone, cigarette) that a single JPEG may miss.

## Who requested it

Product / operations stakeholder (2026-09-07), for MD300 DMS.

## Current limitations

1. MD300 already **raises** DMS/ADAS alarms (Meitrack event 126). The platform stores and shows them.
2. If the device attached a `photoName`, the operator can **click** to download that JPEG (`D00`) and try to play SD video around that time (`AB4`).
3. The operator can take a **new** photo after opening the alarm (`D03`). That is after the fact, not at trigger time.
4. There is **no confirmed business rule** that every DMS alarm must cause the device to capture a driver photo **and** a short video automatically.
5. Whether the device currently writes those files depends on firmware and MD300 settings, not on an approved platform workflow.

## Changelog

- 2026-09-07: Initial.
- 2026-09-07: Stakeholder confirmed ADAS is in scope with the same driver photo/video, not road-camera evidence.
