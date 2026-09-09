# Workflow

## Work order lifecycle

```
Create WO
   ↓
OPEN
   ↓
ASSIGNED (optional)
   ↓
IN_PROGRESS
   ↓
COMPLETED ──► (immutable)
   ↑
CANCELLED ◄── from OPEN / ASSIGNED / IN_PROGRESS
```

## Preventive path

```
Create PM schedule
   ↓
Idle / tracking meters
   ↓
Due detected
   ↓
Generate preventive WO (if none open for schedule)
   ↓
Same WO lifecycle as above
   ↓
On COMPLETE → advance schedule next_due / next odometer target
```

## Alternative paths

- Create WO without PM (corrective / inspection).
- Cancel before complete.
- PM disabled → no due generation.
