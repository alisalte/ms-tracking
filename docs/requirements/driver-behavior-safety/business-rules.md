# Business rules

Sprint 1 rules **locked 2026-09-09** for implementation. Sprint 2–3 rows remain open.

| ID | Topic | Status | Sprint 1 lock |
|----|-------|--------|---------------|
| BR-01 | Hard-brake threshold | **Locked** | Device D79 / Meitrack event 129 (`BRAKING`); no platform g-threshold |
| BR-02 | Overspeed definition | **Locked** | Existing alarm rule `overspeed.thresholdKmh` (+ grace); also device OVERSPEED if raised |
| BR-03 | Idle definition | **Locked** | Existing `prolonged_idle` rule (`minDurationSec`, default 900); PTO excluded upstream in idle FSM |
| BR-04 | Score scale | **Locked** | 0–100; **higher = safer** |
| BR-05 | Weights / period | **Locked** | Default window 30d. Deductions from 100: HARSH_BRAKE −5 (cap −40), SPEED_VIOLATION −4 (cap −40), RAPID_ACCELERATION −3 (cap −20), EXCESSIVE_IDLE −2 (cap −20). Floor 0. |
| BR-06 | Minimum sample | **Locked** | Require overlapping assignment in period to show score; if no attributed events → 100 |
| BR-07 | Unattributed events | **Locked** | Persist with `driver_id` null; **exclude from score** |
| BR-08 | Ranking ties | **Locked** | Lower score ranks first (risk order); ties by name A→Z; tenant-wide ACTIVE with assignment only |
| BR-09 | Notifications | **Locked (Sprint 2)** | Severe events → existing alarm → Notification Center. Score ≤70 → in-product `needsAttention` badge (no new in-app dispatch yet) |
| BR-10 | Coaching | Open | Sprint 3 |
| BR-11 | Risk prediction | Open | Sprint 3 |
| BR-12 | Evidence retention | Open | Sprint 3 |

Source aspirational model: `docs/modules/Driver-Management.md` BehaviorScore / DrivingEvent.
