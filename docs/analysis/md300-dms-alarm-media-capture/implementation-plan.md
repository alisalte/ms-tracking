# Implementation plan

## Prerequisites

- SRS answers locked (done 2026-09-07)
- Phase 1 portfolio includes F-07 (approved)
- Analysis approved by stakeholder (**this gate**)

## Tasks (one at a time)

| # | Task | Est. | Depends |
|---|------|------|---------|
| 1 | Migration `alarm_evidence` + domain status helpers | S | — |
| 2 | Enqueue on DMS/ADAS alert create + cooldown | M | 1 |
| 3 | Worker: auto D00 → persist photo + ACK handling | M | 2 |
| 4 | Evidence read/download API | S | 3 |
| 5 | Dashboard: status + prefer platform JPEG | S | 4 |
| 6 | Video window job + durable ingest (MediaMTX/MinIO) | L | 3 |
| 7 | Retention sweeper 30d + offline retries | M | 3,6 |
| 8 | Tests + docs/`known-limitations` update | S | 5+ |

**Recommended Phase 1 ship:** tasks **1–5** (+ partial 7 for photo expiry).  
Task **6** is the main risk; confirm before coding (see `questions.md`).

## Sequencing note

Do **not** start cloud AI video (F-07 v2) until Slice 1–2 reliability is proven.
