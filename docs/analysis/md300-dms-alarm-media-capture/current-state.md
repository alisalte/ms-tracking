# Current state

## What works today

1. **Decode:** device-gateway CCE event **126** / `0xFE31` → `DMS_*` / `ADAS_*` + optional `photoName`.
2. **Alarm store:** notification-service `notification.alerts` with `detail` JSON (may include `photoName`); 60s occurrence dedup (not media cooldown).
3. **Operator evidence (opt-in):** Alarm drawer → click → D00 (by `photoName`) and/or AB4/AB8 via fleet-management commands; JPEG returned in command ACK; video is **live HLS from device SD** (not durable platform object).
4. **Manual photo:** D03 → D00 after opening the alarm (post-event).
5. **Device config:** C90 DMS toggles; CB8 event-channel recording — device-side, not platform ingest.

## What does not exist

| Capability | Status |
|------------|--------|
| Auto capture/fetch on alarm raise | ❌ |
| Alarm ↔ media DB link | ❌ (only heuristic `photoName`) |
| Platform-stored JPEG/clip | ❌ (transient ACK / HLS) |
| Media cooldown 1/min per type | ❌ |
| 30-day retention sweeper | ❌ |
| Capture status on alarm row | ❌ |
| MinIO/S3 usage from apps | ❌ (infra may exist; unused) |
| Cloud `video-ai-engine` | ❌ (out of F-07 v1) |

## Key code

- Gateway: `meitrack.decode.ts`, `meitrack.codes.ts`, photo assembler
- Alarms: `alarm-evaluator.service.ts`
- Commands: `device-command.service.ts`, command ACK consumer
- UI: `AlarmEvidence.tsx`, `useAlarmEvidence.ts`, `AlarmEventVideo.tsx`
