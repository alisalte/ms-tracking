# Fleet Intelligence Roadmap — Portfolio Analysis

## Intent

User-proposed “quick value / Phase 2 / Phase 3” backlog (Driver Behavior, Fleet Health Score, Fuel Analytics, Geofence Intelligence, Report Builder, Predictive Maintenance + CMMS, AI Video Events, Digital Twin, AI Fleet Assistant, ETA Prediction, Optimization Engine) was marked as complete (✅). This analysis checks **what actually exists in the repo**, how to implement each item, and a **realistic re-phasing** against code + canonical vision (`docs/specs/00_Project_Vision.md` §7).

## Verdict (one line)

**None of the eleven items are fully shipped.** Closest live capabilities: geofence enter/exit/dwell + geofence reports, fixed reports + CSV, DMS/ADAS alarm decode + opt-in evidence, OSRM plan duration (not live ETA), and a connectivity “Fleet Health” panel (not a scored health index).

## Status

Analysis drafted — **waiting for answers** in `questions.md` before any implementation kickoff.

## Docs in this folder

| File | Purpose |
|------|---------|
| `requirements.md` | Capability definitions for the eleven items |
| `current-state.md` | What the repo already has |
| `gap-analysis.md` | Proposed ✅ vs reality |
| `proposed-design.md` | Implementation approach per feature |
| `domain-impact.md` | Bounded contexts touched |
| `database-impact.md` | Persistence needs |
| `api-impact.md` | Services / APIs |
| `ui-impact.md` | Dashboard surfaces |
| `implementation-plan.md` | Recommended re-phasing |
| `risks.md` | Risks |
| `questions.md` | Product decisions needed |
| `status.md` | Workflow status |
