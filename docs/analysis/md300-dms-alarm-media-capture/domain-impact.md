# Domain impact

| Aggregate / BC | Change |
|----------------|--------|
| Alert (notification) | Optional link to Evidence; detail still carries `photoName` |
| DeviceCommand | Auto-issued D00/AB4 from evidence worker (system actor) |
| AlarmEvidence (new) | Status machine: PENDING → RUNNING → PHOTO_READY / VIDEO_READY / PARTIAL / FAILED / SKIPPED_COOLDOWN |
| Media / VideoPlatform | Later: durable clip objects; not live session |

Privacy: persist cabin frames **only** when alert raised (existing policy) — evidence rows exist only for DMS/ADAS alerts.
