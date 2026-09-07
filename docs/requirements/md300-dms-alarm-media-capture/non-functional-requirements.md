# Non-Functional Requirements

| ID | Category | Requirement | Status |
|---|---|---|---|
| NFR-01 | Localization | Operator-facing labels remain FA/EN i18n. | Confirmed (platform standard) |
| NFR-02 | Security / privacy | Driver-face frames are persisted only because an alarm was raised. Retention **30 days**. | Confirmed |
| NFR-03 | Authorization | Only users who may view the alarm may view its photo/video. | Confirmed (existing alarm evidence) |
| NFR-04 | Performance | Capture / ingest must not block raising or displaying the alarm itself. | Confirmed |
| NFR-05 | Availability | If the device cannot store media, the alarm still reaches the platform. If GPRS is down, media syncs later (FR-16). | Confirmed |
| NFR-06 | Bandwidth | Clip is capped at 15 s with audio (cabin only) to limit cellular use. | Confirmed |
| NFR-07 | Audit | Viewing/download audit trail is **not required** for this release. | Confirmed out |
| NFR-08 | Reliability | Photo and video for one alarm must not be swapped with another vehicle or another alarm. | Confirmed |

## Changelog

- 2026-09-07: Initial.
- 2026-09-07: Retention 30d; audit not required; bandwidth cap = 15 s clip.
