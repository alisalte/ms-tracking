# Risks

| Risk | Mitigation |
|------|------------|
| Wrong hours if history missing | Block “true driver work” marketing until Slice B+C |
| Shared vehicles / missing unassign | Enforce one open assignment; audit UI |
| Device rebinds mid-assignment | Document device-at-T as best-effort; optional device-binding history later |
| Alarm without driver stamp (legacy) | Interval overlap fallback query |
| Privacy (cabin / DMS) | No face ID; alarms already governed by existing media policy |
