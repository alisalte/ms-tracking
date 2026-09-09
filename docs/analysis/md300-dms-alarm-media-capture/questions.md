# Questions

No SRS blockers remain. Engineering choices for analysis approval:

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | **Approve analysis & start Slice 1 (auto photo + status UI)?** | **Yes** — unblocks Phase 1 F-07 |
| 2 | **Video in Phase 1:** durable MinIO ingest now, or after photo ship? | **After photo** — MediaMTX→object path is greenfield |
| 3 | **Evidence table home:** `notification` vs `fleet` schema? | **`notification`** next to alerts |
| 4 | **Trigger:** Kafka `alert.created` vs inline after alert insert? | **Inline enqueue + worker** first (simpler); Kafka if cross-service lag appears |
| 5 | Keep manual D00/AB4 fallback forever? | **Yes** as fallback when platform artifact missing |

Reply e.g. **«تحلیل تأیید — شروع Slice 1»** (and optionally confirm Q2–Q5).
