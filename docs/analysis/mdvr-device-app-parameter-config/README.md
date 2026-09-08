# MDVR Device App Parameter Config — Analysis

**Feature id:** `mdvr-device-app-parameter-config`  
**Requirements:** `docs/requirements/mdvr-device-app-parameter-config/` (Approved 2026-09-08)  
**Status:** Analysis complete — **waiting for explicit go-ahead to implement**

## Documents

| File | Purpose |
|------|---------|
| [requirements.md](./requirements.md) | Trace to SRS |
| [current-state.md](./current-state.md) | What exists |
| [gap-analysis.md](./gap-analysis.md) | Gaps |
| [proposed-design.md](./proposed-design.md) | UX + command mapping |
| [domain-impact.md](./domain-impact.md) | Domain |
| [database-impact.md](./database-impact.md) | Persistence |
| [api-impact.md](./api-impact.md) | APIs |
| [ui-impact.md](./ui-impact.md) | UI |
| [implementation-plan.md](./implementation-plan.md) | Phases |
| [risks.md](./risks.md) | Risks |
| [questions.md](./questions.md) | Residual tech Qs |
| [status.md](./status.md) | Workflow |

## Recommended Phase 1

Product UI **Device Parameter → Alarm** on `/commands` (or Video Wall wizard sibling): event table + Link Sett drawer, composing existing Meitrack catalog commands (`B91`, `B99`, `B07`, geofence, `D72`/`C01`, `CB8`, FTP cmds) — **not** a new device protocol.
