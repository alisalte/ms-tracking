# Workflow

## Event path

```
Device FUEL_* / tank sample  ──┐
Manual refill entry          ──┼──► Persist fuel event
CSV/import (if approved)     ──┘         │
                                         ▼
                              Summarize / flag anomaly
                                         │
                                         ▼
                              Fuel UI + optional alarm link
```

## Anomaly path

```
Level/volume time series
   ↓
Detect rapid drop (BR-11)
   ↓
Create anomaly record / raise or link fuel-theft alarm
   ↓
Ops reviews in Fuel UI / Notification Center
```

## Alternative

- No device data → manual-only fleet still gets refill log + basic totals.
- No distance → liters summary without efficiency.
