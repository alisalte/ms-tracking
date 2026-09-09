# Gap analysis

| SRS | Gap |
|-----|-----|
| FR-01 photo at alarm | No auto D00 / no store; depends on device writing `photoName` + operator click |
| FR-02/09/12 15 s + audio | No auto AB4; window today is UI heuristic (−60s/+3m), not 5+10; audio not validated |
| FR-03 attribution | No `alarm_id` ↔ media row |
| FR-04/11 auto platform | No worker; media not on platform |
| FR-05 click load | Exists but fetches from device, not platform objects |
| FR-06/07 failure visible | Errors only after click; no proactive status |
| FR-13 media cooldown | Missing (alarm dedup ≠ media cooldown) |
| FR-16 offline sync | Device-dependent; platform has no reconnect retry queue for evidence |
| FR-17 30-day retention | Missing |

**Hard dependency:** True “device captured at DMS instant” (FR-16 local capture) is **firmware/settings**. Platform can only: (a) consume `photoName` / SD files if present, (b) issue follow-up commands when online, (c) persist what arrives. Documented in `known-limitations.md`.
