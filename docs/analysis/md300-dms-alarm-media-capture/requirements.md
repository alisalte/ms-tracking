# Requirements (traceability)

Source of truth: `docs/requirements/md300-dms-alarm-media-capture/`.

| SRS | Summary |
|-----|---------|
| FR-01..03 | Cabin photo + 15 s cabin video attributable to the alarm |
| FR-04, FR-11, FR-16 | Capture/ingest without operator online; offline → sync when GPRS returns |
| FR-05, BR-15 | Click-to-load UI OK; files already on platform |
| FR-06..07 | Capture failure visible; alarm still raised |
| FR-08..10 | All DMS types + ADAS; cabin only (not road ADAS video) |
| FR-12 | Audio on clip |
| FR-13 | ≤1 photo+clip per alarm type per 1 minute (device/vehicle) |
| FR-14 | Cabin camera required |
| FR-15 | Non-DMS/ADAS unchanged |
| FR-17 | 30-day platform retention |

Out of scope (SRS): live wall redesign, continuous recording, non-MD300, coaching attach, tenant on/off UI, face blur, auto-open without click.
