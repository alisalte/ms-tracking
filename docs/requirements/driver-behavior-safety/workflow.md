# Workflow (conceptual)

```
Device / telemetry / alarm
        ↓
 Detection (hard brake | overspeed | idle | …)
        ↓
 Attribute to driver? ──no──→ store as vehicle-only / unattributed
        │ yes
        ↓
 Behavior event store
        ↓
    ┌───┴───┐
    ↓       ↓
 Notify   Score job (period)
    ↓       ↓
 Inbox   Driver Score
            ↓
     Ranking + Dashboard
            ↓
   (Sprint 3) Evidence · Coaching · Risk model
```

Alternative paths (TBD):

- Late media attach after event.
- Manual score override / exclude event (allowed?).
- Recalculation after assignment history correction.
