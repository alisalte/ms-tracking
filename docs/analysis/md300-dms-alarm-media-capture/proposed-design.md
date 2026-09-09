# Proposed design

## Goal

Make every DMS/ADAS alarm carry a **platform evidence record** (status + artifacts) filled by a **background worker**, not by the operator opening the drawer.

## Architecture (v1)

```
alarm.raw / alert created (DMS|ADAS)
        ↓
EvidenceCaptureService (fleet-management or notification)
  - cooldown gate (deviceId + alarmType, 60s)
  - insert alarm_evidence job PENDING
        ↓
Worker
  1) Photo: D00(photoName) if present → store JPEG bytes/object → PHOTO_READY
     else PHOTO_MISSING / FAILED
  2) Video: schedule cabin channel playback window [t−5s, t+10s]
     → attempt durable ingest (Slice 2) OR mark VIDEO_PENDING_DEVICE
        ↓
UI: show status; click loads **platform** photo first; video from object or fallback AB4
```

## Ownership

| Concern | Service |
|---------|---------|
| Alarm identity + detail (`photoName`, type) | notification-service |
| Evidence jobs + command issue + artifact metadata | **fleet-management-service** (already owns device commands / ACK) |
| JPEG/clip bytes | Prefer **Postgres BYTEA / text** for photo v1; MinIO when video ingest lands |
| Retention sweeper | Same service as artifacts |
| UI | web-dashboard AlarmEvidence |

Avoid new microservice for v1.

## Slice strategy

### Slice 1 — Auto photo evidence (ship first)

1. Table `notification.alarm_evidence` (or `fleet.alarm_evidence`) keyed by `alert_id`.
2. On DMS/ADAS alert create → enqueue job (Kafka event or in-process hook after alert insert).
3. Cooldown FR-13: skip media if same `device_id`+`type` succeeded within 60s; still create evidence row `SKIPPED_COOLDOWN`.
4. Worker issues D00 when `photoName` present; on ACK persist photo + `PHOTO_READY`.
5. API `GET /alerts/:id/evidence` (or embed in alert DTO).
6. UI: badge (Ready / Pending / Failed / Missing); click prefers platform JPEG.

### Slice 2 — 15 s cabin video on platform

1. Worker requests AB4 (or device event clip) for cabin cam `[raisedAt−5s, raisedAt+10s]`.
2. Record path: MediaMTX → file → MinIO (or gateway captures RTMP) — **requires infra plumbing** (MinIO unused today).
3. Store object key + hash; UI plays from platform URL.
4. Audio: rely on device stream; verify in acceptance.

### Slice 3 — Retention + reconnect retry

1. 30-day delete/GC sweeper.
2. Retry PENDING jobs when device returns online (command failure / offline).
3. Visible failure reasons on drawer.

## Non-goals v1

- Cloud AI re-inference
- Face blur
- Coaching auto-attach
- Changing C90 / which DMS types fire
