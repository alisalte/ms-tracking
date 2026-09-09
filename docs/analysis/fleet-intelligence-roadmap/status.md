# Status

| Step | State |
|------|-------|
| Requirements capture (portfolio) | Done — `requirements.md` |
| Current-state inventory | Done — `current-state.md` |
| Gap analysis | Done — `gap-analysis.md` |
| Proposed design | Done — `proposed-design.md` |
| Impact analyses | Done — domain / db / api / ui |
| Implementation / re-phasing plan | Done — `implementation-plan.md` |
| Risks | Done |
| Questions to product | **Defaults locked** (2026-09-09) — see below |
| Phase 1 (Q0+Q1) | **Complete** (2026-09-09) — see caveats below |
| Phase 2 (Q2) | **In progress** — Fuel Analytics: **Requirements Approved** + analysis pack `docs/analysis/fuel-analytics-v1/` (waiting implement approval). CMMS skipped. |
| Implementation | Phase 1 complete; Fuel coding blocked on Analysis Approved |

**Last updated:** 2026-09-09

## Phase 1 scope (Complete)

**Shipped (Q0 + Q1):**
1. Q0 — Driver assignment history
2. F-04 — Geofence Intelligence v1 polish
3. F-01 — Driver Behavior Sprint 1–2
4. F-07 — AI Video Events v1 (auto photo + AB4 5+10 prime; MinIO archive deferred)
5. F-05 — Report schedule v1 (CSV download; email deferred)
6. F-02 — Fleet Health Score v1 (rule-based)

**Phase 1 caveats (not blockers for Q2):** scheduled-report email, durable MinIO video objects, Driver Behavior Sprint 3.

## Phase 2 scope (Q2 — proposed)

| Priority | ID | Slice |
|----------|----|-------|
| — | F-06a | CMMS **skipped** (2026-09-09) — SRS draft archived, not implementing |
| 1 (active) | F-03 | Fuel Analytics **v1** — SRS draft, waiting approval |
| 2 | F-04 | Geofence Intelligence **v2** (route/corridor) |
| 3 | F-10 | ETA Prediction **v1** |
| 4 | F-01 | Driver Behavior Sprint 3 (coaching + video) |

**Still deferred to Q3+:** Predictive Maintenance, Report Builder visual, Optimization, cloud AI video, Twin, Assistant.

## Locked defaults (open questions)

| # | Default |
|---|---------|
| 1 | Prior ✅ marks were incorrect; backlog not shipped |
| 2 | Health Score v1 = connectivity + open alarms (rule-based) |
| 3 | Fuel → Phase 2 (Q2); data source TBD |
| 4 | Report Builder Q1 = schedule existing reports only |
| 5 | CMMS → Phase 2; decide build vs integrate then |
| 6 | Twin + Assistant → Phase 4 / explore later |
| 7 | ETA/Optimization = greenfield → Phase 2–3 |
| 8 | Sequencing = **safety-first** |
| 9 | No hard demo date assumed |
| 10 | Q0–Q4 = working engineering roadmap; vision §7 stays canonical |

## Q2 open decisions (need before coding)

| # | Question | Recommendation |
|---|----------|----------------|
| A | Start with **CMMS core (F-06a)** first? | **Yes** — unlocks maintenance page + later predictive |
| B | CMMS: **build in-repo** vs integrate external? | Prefer thin in-repo work orders first unless you already have a CMMS vendor |
| C | Fuel data source for F-03? | Decide before Fuel sprint (CAN/sensor / refill events / import) |

Reply e.g. **«فاز ۲ از CMMS — build داخلی»** (and optionally fuel source).
