# Status

- Phase: **Requirements Approved** (Sprint 1–2 defaults locked 2026-09-09)
- Analysis: lean (portfolio + this kickoff); full analysis folder deferred
- Implementation: **Sprint 1 + Sprint 2 done**; Sprint 3 still draft

## Approval gate

Stakeholder requested Phase 1 → Driver Behavior. Critical open questions locked for Sprint 1–2. Sprint 3 remains draft.

## Sprint 1 locked defaults

| # | Decision |
|---|----------|
| Detection | **Reuse existing alarms** — overspeed + prolonged_idle rules; hard brake / harsh accel from device `BRAKING` / `ACCELERATION` (D79) |
| Overspeed | Existing notification rule `thresholdKmh` + grace (no new detector) |
| Idle | Existing `prolonged_idle` (default minDurationSec 900) |
| Hard brake | Device event 129 → alarmCode `BRAKING` (catalog type may be `collision`) |
| Harsh accel | Included in Sprint 1 score (device 130 / `ACCELERATION`) |
| Attribution | Via `fleet.driver_assignments` at `raisedAt`; unattributed events stored but **excluded from score** |
| Score scale | **0–100**, higher = safer |
| Period | Default **30 days** (API accepts from/to) |
| Formula | Start 100; deduct per event type with caps (see `business-rules.md`) |
| Min sample | Score shown if driver has ≥1 assignment overlapping period; 100 if no attributed events |

## Sprint 2 locked defaults

| # | Decision |
|---|----------|
| Ranking | Tenant-wide; lowest score first; ACTIVE + assignment overlap |
| Driver dashboard | Enrich existing driver drawer (score, delta vs prior period, events) |
| Notifications | Severe events → existing alarm → Notification Center; score ≤70 → `needsAttention` badge (no new dispatcher yet) |

## Changelog

- 2026-09-09: Sprint 2 ranking + drawer delta + attention badge implemented.
- 2026-09-09: Requirements Approved for Sprint 1; events + Driver Score implemented.
- 2026-09-08: Draft SRS created from three-sprint backlog (Hard Brake → ML Risk Prediction).
