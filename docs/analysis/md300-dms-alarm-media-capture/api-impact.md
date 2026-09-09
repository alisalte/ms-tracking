# API impact

| API | Change |
|-----|--------|
| Internal: alert created hook / Kafka `notification.alert.created` | Trigger evidence enqueue for DMS/ADAS |
| `GET /api/v1/notifications/alerts/:id/evidence` (or fleet path) | Status + photo URL/bytes metadata + video availability |
| `GET .../evidence/photo` | Authenticated JPEG download from platform store |
| `GET .../evidence/video` | Slice 2 object URL or signed link |
| Existing `POST .../devices/:id/commands` | Used by **worker**, not only UI |
| Alert list/detail DTO | Optional `evidenceStatus` field |

Permissions: reuse `notification.alert.read` / media read; no new permission unless downloading becomes export-like.

No public breaking change to existing opt-in D00 path — keep as fallback when platform evidence missing.
