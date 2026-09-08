# Driver Behavior & Safety Score

Proposed product delivery in three sprints (stakeholder backlog, 2026-09-08).

| Sprint | Capabilities |
|--------|----------------|
| **1** | Hard Brake Detection · Overspeed Detection · Idle Detection · Driver Score |
| **2** | Ranking · Driver Dashboard · Notifications |
| **3** | Video Evidence · AI Coaching · ML Risk Prediction |

## Documents

| File | Purpose |
|------|---------|
| [business-problem.md](./business-problem.md) | Why |
| [business-goals.md](./business-goals.md) | Success outcomes |
| [scope.md](./scope.md) | In / out / future |
| [actors.md](./actors.md) | Who |
| [functional-requirements.md](./functional-requirements.md) | What the system must do |
| [non-functional-requirements.md](./non-functional-requirements.md) | Quality attributes |
| [business-rules.md](./business-rules.md) | Policies (unconfirmed) |
| [use-cases.md](./use-cases.md) | Primary scenarios |
| [workflow.md](./workflow.md) | Event → score → coach flow |
| [acceptance-criteria.md](./acceptance-criteria.md) | Testable criteria (draft) |
| [assumptions.md](./assumptions.md) | Unconfirmed defaults |
| [open-questions.md](./open-questions.md) | Blocking questions |
| [status.md](./status.md) | Approval gate |

## Related existing work

- Module design (aspirational): `docs/modules/Driver-Management.md` (BehaviorScore, DrivingEvent).
- Analysis: `docs/analysis/driver-work-device-alarms/` (assignment history, alarm attribution gaps).
- Evidence / DMS media: `docs/requirements/md300-dms-alarm-media-capture/`.
- On-device thresholds already configurable: Parameter Alerts (B07 / D79) — **not** the same as platform scoring.

## Status

**Draft SRS** — waiting on critical answers and explicit **Requirements Approved** before Feature Analysis or implementation.
