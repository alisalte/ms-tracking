# Assumptions

Remaining assumptions are implementation-neutral defaults. Stakeholder answers converted former open assumptions into requirements.

| ID | Status | Statement |
|---|---|---|
| AS-01 | **Confirmed** | “راننده” = cabin / driver-facing camera only, including when the alarm is ADAS. |
| AS-02 | **Confirmed** | Capture is automatic at alarm creation. |
| AS-03 | **Confirmed** | Device scope is MD300 (same MDVR class). |
| AS-04 | **Confirmed** | 5 s before + 10 s after. |
| AS-05 | **Confirmed** | Both photo and video, except during cooldown (alarms still raise). |
| AS-06 | **Confirmed** | Operator may click once to load evidence; ingest is automatic. |
| AS-07 | **Confirmed** | ADAS is in scope; still driver media. |
| AS-08 | **Confirmed** | Media lands on the platform automatically (sync if offline). |
| AS-09 | Open (non-blocking) | “Alarm type” for cooldown means the canonical type (e.g. `DMS_PHONE_CALL`), not the generic event 126. |
| AS-10 | Open (non-blocking) | 30-day retention starts at alarm time. |

AS-09 and AS-10 do not block analysis if the stakeholder accepts them as defaults.

## Changelog

- 2026-09-07: Initial.
- 2026-09-07: Converted AS-01–AS-08 to confirmed; left two non-blocking defaults.
