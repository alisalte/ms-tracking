# Open questions

## Critical — resolved by Approval defaults (2026-09-08)

| # | Question | Resolution |
|---|----------|------------|
| 1 | Scope of «کامل» | **Phase 1:** Alarm Event list + Link Sett (screenshots). Full Parameter app later. |
| 2 | Device models | Meitrack MDVR in existing catalog; **MD300 primary**. |
| 3 | Event list | Screenshot set + known `MEITRACK_EVENTS` codes used in Link Sett; expand later. |
| 4 | Delivery order | Alarm UI first. |

## Important — defaults

| # | Question | Resolution |
|---|----------|------------|
| 5 | Refresh/readback | Required when protocol supports; else show unknown + allow set. |
| 6 | Associated phones | Up to **3**; SMS and Call flags per phone (map to B99 / A71 as design allows). |
| 7 | Outputs | UI shows Output1–7; send only ports supported by command (C01/D72/B99 today 1–5/OUT1–2) — honest disable for unsupported. |
| 8 | Permission | `telemetry.command.send` (+ read for history). |

## Optional (later)

9. Sync with `/alarms/rules` — **out of Phase 1** (remain separate).  
10. Clone settings across devices — later.

## Changelog

- 2026-09-08: Initial blocking list.
- 2026-09-08: Defaults locked on stakeholder `Approved`.
