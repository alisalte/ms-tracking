# Business Rules

Only rules that are **requested or already true in the product**. Nothing below invents device firmware behavior as a policy.

## Confirmed (current product)

| ID | Rule |
|---|---|
| BR-01 | MD300 can raise DMS/ADAS alarms (event 126). |
| BR-02 | Those alarms are shown to operators in the alarm/notification UI. |
| BR-03 | Driver-facing media is a privacy-sensitive artifact; existing platform policy is not to persist cabin frames unless an alert is raised. |
| BR-04 | Evidence for an alarm must be tied to that alarm, not an arbitrary nearby file, when the operator is reviewing a DMS event. |

## Requested (this feature) — confirmed 2026-09-07

| ID | Rule |
|---|---|
| BR-10 | On every DMS and ADAS alarm (all types), a photo of the **driver** is captured. |
| BR-11 | On those alarms, a 15 s driver video is captured: 5 s before + 10 s after, **with audio**. |
| BR-12 | Photo and video are delivered to the platform automatically (or when GPRS returns). |
| BR-13 | At most one photo+clip per alarm type per 1 minute (same vehicle/device). Alarms inside the cooldown still exist without new media. |
| BR-14 | Platform keeps that media **30 days**. |
| BR-15 | Operator may click to load evidence; ingest does not wait for that click. |
| BR-16 | Camera/storage failure does not suppress the alarm. |

## Changelog

- 2026-09-07: Initial. No new rules treated as fact.
- 2026-09-07: Stakeholder confirmed BR-10–BR-16.
