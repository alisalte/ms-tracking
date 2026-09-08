# Gap analysis

| Vendor app capability | Platform today | Gap |
|----------------------|----------------|-----|
| Event settings list + Refresh | No table UI | **Build UI** + event catalog |
| Associated phone SMS/Call | A71 + B99 fragments | **Compose** UX; verify B99 phone semantics |
| Alarm head | B91 | Wire to UI |
| Delay recording (S) | No first-class “delay recording” command in catalog grep | **Research / add catalog entry** or map to CB8 seconds / media param |
| GPRS / FTP / VOICE linkage | B99 GPRS; FTP cmds; VOICE unclear | Map GPRS/FTP; VOICE may be CALL or gap |
| Output1–7 checkboxes | C01 (1–5), D72, B99 OUT1–2 | UI honesty for unsupported 6–7 |
| CH Recording / Screenshot / OSD | CB8 (event/channel/time); screenshot/OSD cmds? | Partial — may need more catalog |
| Input 8 inactive row | Not in MEITRACK_EVENTS | **Done in Parameter UI** (codes 2–16); gateway named map still optional |
| Full Parameter app | Wizard categories | Phase 2 |

## Critical technical gap

**Delay recording time** and **VOICE / OSD / Screenshot** may not have 1:1 catalog commands. Phase 1 must either (a) add missing Meitrack encode entries from protocol PDF, or (b) hide unsupported checkboxes with “not supported on this firmware”.
