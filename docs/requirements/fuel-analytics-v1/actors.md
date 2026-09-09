# Actors

| Actor | Responsibility |
|-------|----------------|
| Fleet admin / ops manager | View analytics, configure thresholds (if any), enter manual refills |
| Dispatcher / supervisor | View consumption and anomalies |
| Viewer | Read-only if granted `fuel.read` |
| System | Ingest device fuel events; compute summaries / flag drops |
| Device (MDVR / sensor) | Emits FUEL_* / tank level (when hardware present) |
