# Workflow

```
Select device
    ↓
Open Device Parameter (Alarm [+ other sections if in scope])
    ↓
Refresh / readback current settings ──fail──→ show error, allow retry
    ↓
Browse event list
    ↓
Open Link Sett for one event
    ↓
Edit fields → Setting
    ↓
Platform sends protocol command(s)
    ↓
ACK OK → UI updated / toast success
ACK fail → error, retain previous display
    ↓
Cancel → discard local edits
```

## Changelog

- 2026-09-08: Initial.
