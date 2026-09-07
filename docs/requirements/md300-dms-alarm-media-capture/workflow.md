# Workflow

Happy path (business, not commands):

```
DMS or ADAS condition on MD300
        ↓
Alarm created
        ↓
Driver photo + 15 s driver video with audio (5 s before / 10 s after)
        ↓                    ↘ if GPRS down: store locally → sync on reconnect
Platform has alarm + media (auto ingest)
        ↓
Operator opens alarm → clicks load evidence
        ↓
Sees photo and short video for this alarm
        ↓
(optional) download
        ↓
After 30 days: platform media may expire
```

Alternative: capture fails → alarm still visible → operator sees missing evidence.

Alternative: device reconnects later → media associated when available (**if** UC-03-A is chosen).

Cancellation: not applicable (capture is not an approval workflow).

## Changelog

- 2026-09-07: Initial.
- 2026-09-07: Offline sync, click-to-load, 30-day expiry added to the flow.
