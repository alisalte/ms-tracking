# Use Cases

## UC-01 — DMS or ADAS alarm with successful capture

1. Device detects an in-scope DMS or ADAS condition and creates the alarm.
2. Device captures a driver photo and a 15 s driver video with audio (5 s before + 10 s after).
3. Media is delivered to the platform (immediately, or when GPRS returns).
4. Operator opens the alarm, clicks to load evidence, sees that photo and plays the clip for **this** alarm.

## UC-02 — Camera unavailable

1. Alarm is created (e.g. camera occlusion, or no cabin channel).
2. Photo and/or video cannot be captured.
3. Alarm is still created and visible.
4. Operator sees that evidence is missing.

## UC-03 — Device offline at trigger time

1. GPRS is down when the alarm fires.
2. Device still writes photo+clip locally.
3. Alarm may reach the platform later or via other buffering already in the protocol.
4. When the device reconnects, photo and video are delivered to the platform and can be loaded from the alarm.

## UC-04 — Rapid repeated alarms (cooldown)

1. Type T already captured media for this vehicle less than 60 seconds ago.
2. Type T raises again.
3. A new alarm is created.
4. No second photo+clip is required; operator may still see the previous capture if product later links it (not required). Missing new media is expected.

## UC-05 — Operator reviews later (within 30 days)

Operator can load the photo and short video for that alarm until 30 days after the alarm.

## UC-06 — Alarm that is neither DMS nor ADAS

No new driver photo/video required by this feature.

## Changelog

- 2026-09-07: Initial.
- 2026-09-07: UC-03 and UC-04 confirmed; ADAS included in UC-01.
