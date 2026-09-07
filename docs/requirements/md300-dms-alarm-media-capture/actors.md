# Actors

| Actor | Responsibility for this feature |
|---|---|
| **Driver** | Subject of the cabin camera. Does not operate the feature. |
| **MD300 device** | Detects DMS, raises the alarm, and (per this request) captures photo + short video of the driver. |
| **Fleet operator / dispatcher** | Reviews the alarm and the captured evidence. |
| **Safety / coaching officer** | Uses photo+clip to confirm behavior and coach. |
| **FleetVision platform** | Receives the alarm, associates evidence, shows it in the alarm UI, respects permissions and retention. |
| **Tenant admin** | May later configure which alarm types capture media (not confirmed). |
| **External systems** | Not in requested scope. |

## Changelog

- 2026-09-07: Initial.
