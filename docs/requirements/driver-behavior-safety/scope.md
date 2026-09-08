# Scope

## Proposed delivery (stakeholder backlog)

### Sprint 1 — Detect & score

| Item | In scope (intent) |
|------|-------------------|
| Hard Brake Detection | Detect / record hard-brake driving events |
| Overspeed Detection | Detect / record overspeed events |
| Idle Detection | Detect / record idle (engine on, not moving / excess idle) events |
| Driver Score | Compute and store a per-driver score from behavior events |

### Sprint 2 — Ops surfaces

| Item | In scope (intent) |
|------|-------------------|
| Ranking | Ordered list of drivers by score (and filters/period) |
| Driver Dashboard | Per-driver view: score, trends, recent events |
| Notifications | Alerts to operators/managers (and maybe drivers) on rules |

### Sprint 3 — Evidence & intelligence

| Item | In scope (intent) |
|------|-------------------|
| Video Evidence | Link or capture video/photo for selected events |
| AI Coaching | Automated or assisted coaching content from events/score |
| ML Risk Prediction | Predictive risk signal for drivers/vehicles/trips |

## Explicitly related but separate

| Topic | Relationship |
|-------|----------------|
| Driver assignment history | Likely **prerequisite** for fair scoring (see driver-work-device-alarms analysis) |
| MD300 DMS media capture | Overlaps Sprint 3 Video Evidence for cabin AI alarms |
| Device Parameter Alerts (B07/D79) | Device thresholds ≠ platform detection/scoring |

## Out of scope (until requested)

- Full license / certification lifecycle (broader Driver Management module).
- Trip dispatch / route planning.
- Regulatory HOS filings.

## Future (not in these three sprints unless pulled in)

- Cornering / harsh accel as separate score inputs (may already feed “hard brake” family — unconfirmed).
- Driver-facing mobile app.
